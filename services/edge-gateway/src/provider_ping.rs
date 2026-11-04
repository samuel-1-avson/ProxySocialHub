//! Provider liveness probe: control-api asks the edge to send `PING` down a node's
//! tunnel and report whether `PONG` came back. Read-only; nothing is recorded.

use crate::state::AppState;
use http_body_util::Full;
use hyper::body::Bytes;
use hyper::header::HeaderMap;
use hyper::{Response, StatusCode};
use std::future::Future;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio_util::compat::FuturesAsyncReadCompatExt;
use tracing::{debug, warn};

const PATH_PREFIX: &str = "/internal/providers/";
const PATH_SUFFIX: &str = "/ping";
const HDR_GATEWAY_AUTH: &str = "x-gateway-auth";
/// Set when one pod forwards a ping to the owner pod, so it is forwarded at most once.
const HDR_PING_HOP: &str = "x-proxyhub-ping-hop";
/// Covers stream open, write and reply.
const PROBE_TIMEOUT: Duration = Duration::from_secs(4);

/// Node id from `/internal/providers/{id}/ping`, or None for any other path.
pub fn node_id_from_path(path: &str) -> Option<&str> {
    let id = path.strip_prefix(PATH_PREFIX)?.strip_suffix(PATH_SUFFIX)?;
    if id.is_empty() || id.contains('/') {
        None
    } else {
        Some(id)
    }
}

#[derive(Debug, PartialEq, Eq)]
enum ProbeError {
    Timeout,
    StreamFailed,
    BadReply,
}

impl ProbeError {
    fn reason(&self) -> &'static str {
        match self {
            ProbeError::Timeout => "timeout",
            ProbeError::StreamFailed => "stream_failed",
            ProbeError::BadReply => "bad_reply",
        }
    }
}

/// Write `PING`, expect a reply starting with `PONG` (provider-node `handle_stream`).
async fn probe<S: AsyncRead + AsyncWrite + Unpin>(mut stream: S) -> Result<(), ProbeError> {
    stream
        .write_all(b"PING\n")
        .await
        .map_err(|_| ProbeError::StreamFailed)?;
    let mut buf = [0u8; 64];
    let n = stream
        .read(&mut buf)
        .await
        .map_err(|_| ProbeError::StreamFailed)?;
    if n == 0 {
        return Err(ProbeError::StreamFailed);
    }
    if buf[..n].starts_with(b"PONG") {
        Ok(())
    } else {
        Err(ProbeError::BadReply)
    }
}

async fn within<F>(limit: Duration, fut: F) -> Result<(), ProbeError>
where
    F: Future<Output = Result<(), ProbeError>>,
{
    tokio::time::timeout(limit, fut)
        .await
        .unwrap_or(Err(ProbeError::Timeout))
}

pub(crate) fn authorized(headers: &HeaderMap, secret: &str) -> bool {
    if secret.is_empty() {
        return false;
    }
    headers
        .get(HDR_GATEWAY_AUTH)
        .and_then(|v| v.to_str().ok())
        .map(|v| crate::auth::constant_time_eq(v.trim().as_bytes(), secret.as_bytes()))
        .unwrap_or(false)
}

fn result_json(node_id: &str, pod_id: &str, outcome: Result<u64, &str>) -> String {
    let (reachable, rtt_ms, reason) = match outcome {
        Ok(ms) => (true, Some(ms), None),
        Err(reason) => (false, None, Some(reason)),
    };
    serde_json::json!({
        "node_id": node_id,
        "reachable": reachable,
        "rtt_ms": rtt_ms,
        "reason": reason,
        "pod_id": pod_id,
    })
    .to_string()
}

/// Ask the pod that owns the tunnel to run the ping. Returns its JSON body.
async fn forward_to_owner(base_url: &str, node_id: &str, secret: &str) -> Option<String> {
    let url = format!(
        "{}{PATH_PREFIX}{node_id}{PATH_SUFFIX}",
        base_url.trim_end_matches('/')
    );
    let resp = reqwest::Client::new()
        .post(url)
        .header(HDR_GATEWAY_AUTH, secret)
        .header(HDR_PING_HOP, "1")
        .timeout(PROBE_TIMEOUT + Duration::from_secs(1))
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.text().await.ok()
}

/// POST /internal/providers/{node_id}/ping
pub async fn handle(
    state: Arc<AppState>,
    node_id: &str,
    headers: &HeaderMap,
) -> Response<Full<Bytes>> {
    let secret = &state.config.gateway_shared_secret;
    if !authorized(headers, secret) {
        warn!(node_id, "Rejected provider ping: invalid gateway credentials");
        return crate::pod_drain::json_response(
            StatusCode::FORBIDDEN,
            r#"{"error":"forbidden"}"#.to_string(),
        );
    }
    let pod_id = state.provider_directory.pod_id().to_string();

    let Some(mut control) = state.registry.control_for_probe(node_id) else {
        // Not on this pod: forward once to the owner pod, if we know where it is.
        if !headers.contains_key(HDR_PING_HOP) {
            if let Ok(Some(owner)) = state.provider_directory.lookup(node_id).await {
                if !state.provider_directory.is_local_owner(&owner.pod_id) {
                    if let Some(base) = state.config.owner_forward_base_url(&owner.pod_id) {
                        if let Some(body) = forward_to_owner(&base, node_id, secret).await {
                            return crate::pod_drain::json_response(StatusCode::OK, body);
                        }
                    }
                }
            }
        }
        return crate::pod_drain::json_response(
            StatusCode::OK,
            result_json(node_id, &pod_id, Err("not_connected")),
        );
    };

    let started = Instant::now();
    let outcome = within(PROBE_TIMEOUT, async move {
        let stream = control
            .open_stream()
            .await
            .map_err(|_| ProbeError::StreamFailed)?;
        probe(stream.compat()).await
    })
    .await;
    let rtt_ms = started.elapsed().as_millis() as u64;
    debug!(node_id, rtt_ms, ok = outcome.is_ok(), "Provider ping");

    let body = match outcome {
        Ok(()) => result_json(node_id, &pod_id, Ok(rtt_ms)),
        Err(e) => result_json(node_id, &pod_id, Err(e.reason())),
    };
    crate::pod_drain::json_response(StatusCode::OK, body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use hyper::header::HeaderValue;
    use tokio::io::duplex;

    #[tokio::test]
    async fn pong_reply_is_ok() {
        let (edge, mut node) = duplex(64);
        tokio::spawn(async move {
            let mut buf = [0u8; 16];
            let n = node.read(&mut buf).await.unwrap();
            assert_eq!(&buf[..n], b"PING\n");
            node.write_all(b"PONG\n").await.unwrap();
        });
        assert_eq!(within(PROBE_TIMEOUT, probe(edge)).await, Ok(()));
    }

    #[tokio::test]
    async fn silent_node_times_out() {
        let (edge, _node) = duplex(64);
        let got = within(Duration::from_millis(50), probe(edge)).await;
        assert_eq!(got, Err(ProbeError::Timeout));
    }

    #[tokio::test]
    async fn error_reply_is_bad_reply() {
        let (edge, mut node) = duplex(64);
        tokio::spawn(async move {
            let mut buf = [0u8; 16];
            let _ = node.read(&mut buf).await;
            node.write_all(b"ERROR Invalid command\n").await.unwrap();
        });
        assert_eq!(probe(edge).await, Err(ProbeError::BadReply));
    }

    #[tokio::test]
    async fn closed_stream_is_stream_failed() {
        let (edge, node) = duplex(64);
        drop(node);
        assert_eq!(probe(edge).await, Err(ProbeError::StreamFailed));
    }

    #[test]
    fn requires_matching_secret() {
        let mut headers = HeaderMap::new();
        assert!(!authorized(&headers, "s3cret"));
        headers.insert(HDR_GATEWAY_AUTH, HeaderValue::from_static("wrong"));
        assert!(!authorized(&headers, "s3cret"));
        headers.insert(HDR_GATEWAY_AUTH, HeaderValue::from_static("s3cret"));
        assert!(authorized(&headers, "s3cret"));
        assert!(!authorized(&headers, ""));
    }

    #[test]
    fn parses_node_id_from_path() {
        assert_eq!(
            node_id_from_path("/internal/providers/node_abc/ping"),
            Some("node_abc")
        );
        assert_eq!(node_id_from_path("/internal/providers//ping"), None);
        assert_eq!(node_id_from_path("/internal/providers/a/b/ping"), None);
        assert_eq!(node_id_from_path("/internal/providers/node_abc"), None);
    }
}

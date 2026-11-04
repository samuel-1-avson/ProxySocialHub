//! Bounded HTTPS measurements over the exact provider's yamux transport.
//! Targets are fixed here: callers cannot turn assessments into arbitrary fetches.
use crate::state::AppState;
use http_body_util::{BodyExt, Full};
use hyper::{body::Bytes, header::HeaderMap, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use serde::Serialize;
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_util::compat::FuturesAsyncReadCompatExt;

const HOST: &str = "speed.cloudflare.com";
const PATH: &str = "/__down?bytes=262144";
const BYTES: usize = 262144;
const HOP: &str = "x-proxyhub-quality-hop";

pub fn node_id_from_path(path: &str) -> Option<&str> {
    let id = path
        .strip_prefix("/internal/providers/")?
        .strip_suffix("/quality-check")?;
    if id.is_empty()
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        None
    } else {
        Some(id)
    }
}

#[derive(Default, Serialize)]
struct Measurements {
    samples: usize,
    successful_samples: usize,
    latency_p50_ms: f64,
    latency_p95_ms: f64,
    throughput_mbps: f64,
    bytes_transferred: usize,
}

// Abort the HTTP driver on every exit, including cancellation by the sample deadline.
struct Driver(tokio::task::JoinHandle<()>);
impl Drop for Driver {
    fn drop(&mut self) {
        self.0.abort();
    }
}

async fn transfer(mut control: yamux::Control) -> Result<(f64, f64), String> {
    let started = Instant::now();
    let stream = control.open_stream().await.map_err(|_| "stream")?.compat();
    transfer_on_stream(stream, started).await
}

async fn transfer_on_stream<
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
>(
    mut stream: S,
    started: Instant,
) -> Result<(f64, f64), String> {
    stream
        .write_all(format!("CONNECT {HOST}:443\n").as_bytes())
        .await
        .map_err(|_| "connect")?;
    let mut reply = Vec::new();
    loop {
        let byte = stream.read_u8().await.map_err(|_| "connect_reply")?;
        if byte == b'\n' {
            break;
        }
        reply.push(byte);
        if reply.len() > 64 {
            return Err("connect_reply".into());
        }
    }
    if reply != b"OK" && reply != b"OK\r" {
        return Err("connect_refused".into());
    }
    let roots = rustls::RootCertStore {
        roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
    };
    let tls_config = rustls::ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();
    let tls = tokio_rustls::TlsConnector::from(Arc::new(tls_config))
        .connect(
            rustls::pki_types::ServerName::try_from(HOST).map_err(|_| "hostname")?,
            stream,
        )
        .await
        .map_err(|_| "tls")?;
    let (mut sender, connection) = hyper::client::conn::http1::handshake(TokioIo::new(tls))
        .await
        .map_err(|_| "http")?;
    let _driver = Driver(tokio::spawn(async move {
        let _ = connection.await;
    }));
    let request = Request::builder()
        .uri(PATH)
        .header("Host", HOST)
        .header("Accept-Encoding", "identity")
        .body(Full::new(Bytes::new()))
        .map_err(|_| "request")?;
    let response = sender.send_request(request).await.map_err(|_| "response")?;
    let latency = started.elapsed().as_secs_f64() * 1000.;
    if response.status() != StatusCode::OK {
        return Err("target_status".into());
    }
    let download_started = Instant::now();
    let mut body = response.into_body();
    let mut received = 0;
    while let Some(frame) = body.frame().await {
        let frame = frame.map_err(|_| "body")?;
        if let Some(data) = frame.data_ref() {
            received += data.len();
        }
        if received > BYTES {
            return Err("body_limit".into());
        }
    }
    if received != BYTES {
        return Err("body_length".into());
    }
    let mbps =
        (received as f64 * 8.) / download_started.elapsed().as_secs_f64().max(0.001) / 1_000_000.;
    Ok((latency.max(0.001), mbps))
}

pub async fn handle(
    state: Arc<AppState>,
    node_id: &str,
    headers: &HeaderMap,
) -> Response<Full<Bytes>> {
    let secret = &state.config.gateway_shared_secret;
    if !crate::provider_ping::authorized(headers, secret) {
        return crate::pod_drain::json_response(
            StatusCode::FORBIDDEN,
            r#"{"error":"forbidden"}"#.into(),
        );
    }
    let Some(control) = state.registry.control_for_probe(node_id) else {
        if !headers.contains_key(HOP) {
            if let Ok(Some(owner)) = state.provider_directory.lookup(node_id).await {
                if !state.provider_directory.is_local_owner(&owner.pod_id) {
                    if let Some(base) = state.config.owner_forward_base_url(&owner.pod_id) {
                        let reply = reqwest::Client::new()
                            .post(format!(
                                "{}/internal/providers/{node_id}/quality-check",
                                base.trim_end_matches('/')
                            ))
                            .header("x-gateway-auth", secret)
                            .header(HOP, "1")
                            .timeout(Duration::from_secs(35))
                            .send()
                            .await;
                        if let Ok(reply) = reply {
                            let status = reply.status();
                            if let Ok(body) = reply.text().await {
                                return crate::pod_drain::json_response(status, body);
                            }
                        }
                        return unavailable();
                    }
                }
            }
        }
        return crate::pod_drain::json_response(
            StatusCode::OK,
            serde_json::to_string(&Measurements {
                samples: 3,
                ..Default::default()
            })
            .unwrap(),
        );
    };
    // A failed reference target is an infrastructure outage, never a provider penalty.
    let baseline = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build();
    let baseline_ok = match baseline {
        Ok(client) => client
            .get(format!("https://{HOST}{PATH}"))
            .timeout(Duration::from_secs(4))
            .send()
            .await
            .map(|r| r.status() == StatusCode::OK)
            .unwrap_or(false),
        Err(_) => false,
    };
    if !baseline_ok {
        return unavailable();
    }
    let mut result = Measurements {
        samples: 3,
        ..Default::default()
    };
    let mut latencies = Vec::new();
    let mut speeds = Vec::new();
    for _ in 0..3 {
        if let Ok(Ok((latency, speed))) =
            tokio::time::timeout(Duration::from_secs(8), transfer(control.clone())).await
        {
            latencies.push(latency);
            speeds.push(speed);
        }
    }
    latencies.sort_by(f64::total_cmp);
    speeds.sort_by(f64::total_cmp);
    result.successful_samples = latencies.len();
    result.bytes_transferred = latencies.len() * BYTES;
    if !latencies.is_empty() {
        result.latency_p50_ms = latencies[latencies.len() / 2];
        result.latency_p95_ms = latencies[latencies.len() - 1];
        result.throughput_mbps = speeds[speeds.len() / 2];
    }
    crate::pod_drain::json_response(StatusCode::OK, serde_json::to_string(&result).unwrap())
}

fn unavailable() -> Response<Full<Bytes>> {
    crate::pod_drain::json_response(
        StatusCode::SERVICE_UNAVAILABLE,
        r#"{"error":"assessment infrastructure unavailable"}"#.into(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn paths_cannot_inject_targets_or_forwarding_paths() {
        assert_eq!(
            node_id_from_path("/internal/providers/node_abc-123/quality-check"),
            Some("node_abc-123")
        );
        for path in [
            "/internal/providers//quality-check",
            "/internal/providers/../quality-check",
            "/internal/providers/a/b/quality-check",
            "/internal/providers/a?x/quality-check",
            "/internal/providers/a%2fb/quality-check",
        ] {
            assert_eq!(node_id_from_path(path), None);
        }
    }

    #[tokio::test]
    async fn proxy_refusal_cannot_be_scored_as_success() {
        let (edge, mut provider) = tokio::io::duplex(4096);
        tokio::spawn(async move {
            let mut command = [0u8; 128];
            let n = provider.read(&mut command).await.unwrap();
            assert_eq!(&command[..n], b"CONNECT speed.cloudflare.com:443\n");
            provider.write_all(b"ERROR refused\n").await.unwrap();
        });
        assert_eq!(
            transfer_on_stream(edge, Instant::now()).await.unwrap_err(),
            "connect_refused"
        );
    }

    #[tokio::test]
    async fn tunnel_reply_alone_does_not_prove_https_works() {
        let (edge, mut provider) = tokio::io::duplex(4096);
        tokio::spawn(async move {
            let mut command = [0u8; 128];
            let _ = provider.read(&mut command).await;
            provider.write_all(b"OK\n").await.unwrap();
            provider.write_all(b"not a valid TLS server").await.unwrap();
        });
        assert_eq!(
            transfer_on_stream(edge, Instant::now()).await.unwrap_err(),
            "tls"
        );
    }

    #[tokio::test]
    async fn oversized_handshake_is_rejected() {
        let (edge, mut provider) = tokio::io::duplex(4096);
        tokio::spawn(async move {
            let mut command = [0u8; 128];
            let _ = provider.read(&mut command).await;
            provider.write_all(&[b'x'; 65]).await.unwrap();
        });
        assert_eq!(
            transfer_on_stream(edge, Instant::now()).await.unwrap_err(),
            "connect_reply"
        );
    }
}

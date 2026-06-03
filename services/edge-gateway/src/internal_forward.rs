//! Owner-pod internal CONNECT forward (P3.2 colocated peer, P3b tunnel tier).

use crate::auth::SessionAuthenticator;
use crate::state::AppState;
use base64::Engine;
use http_body_util::Full;
use hyper::body::Bytes;
use hyper::header::{HeaderMap, PROXY_AUTHORIZATION};
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use std::sync::Arc;
use std::time::Instant;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tracing::{debug, error, warn};

pub const INTERNAL_FORWARD_HOST: &str = "bridge.internal";
pub const HDR_INTERNAL: &str = "x-proxyhub-internal-forward";
pub const HDR_NODE_ID: &str = "x-proxyhub-node-id";
pub const HDR_DEST: &str = "x-proxyhub-dest";

pub fn is_internal_forward_request<B>(req: &Request<B>) -> bool {
    if req.method() != hyper::Method::CONNECT {
        return false;
    }
    req.headers()
        .get(HDR_INTERNAL)
        .and_then(|v| v.to_str().ok())
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

fn gateway_basic_auth(secret: &str) -> String {
    let token = format!("gateway:{secret}");
    format!(
        "Basic {}",
        base64::engine::general_purpose::STANDARD.encode(token.as_bytes())
    )
}

fn validate_gateway_auth(headers: &HeaderMap, secret: &str) -> bool {
    if let Some(v) = headers.get(PROXY_AUTHORIZATION) {
        if let Ok(s) = v.to_str() {
            if s.trim() == gateway_basic_auth(secret) {
                return true;
            }
        }
    }
    false
}

/// Handle an internal forward CONNECT on the **owner** pod (after gateway auth).
pub async fn handle_internal_forward(
    req: Request<hyper::body::Incoming>,
    state: Arc<AppState>,
    authenticator: Arc<SessionAuthenticator>,
) -> Result<Response<Full<Bytes>>, hyper::Error> {
    let start = Instant::now();

    if !validate_gateway_auth(req.headers(), &state.config.gateway_shared_secret) {
        warn!("Rejected internal forward: invalid gateway credentials");
        let mut resp = Response::new(Full::new(Bytes::from("Forbidden")));
        *resp.status_mut() = StatusCode::FORBIDDEN;
        return Ok(resp);
    }

    let node_id = req
        .headers()
        .get(HDR_NODE_ID)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let dest = req
        .headers()
        .get(HDR_DEST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    if node_id.is_empty() || dest.is_empty() {
        let mut resp = Response::new(Full::new(Bytes::from("Missing node or dest headers")));
        *resp.status_mut() = StatusCode::BAD_REQUEST;
        return Ok(resp);
    }

    let Some(control) = state.registry.get_by_id(&node_id) else {
        warn!(node_id = %node_id, "Internal forward: provider not on this pod");
        let mut resp = Response::new(Full::new(Bytes::from("Provider not available on this pod")));
        *resp.status_mut() = StatusCode::SERVICE_UNAVAILABLE;
        return Ok(resp);
    };

    debug!(node_id = %node_id, dest = %dest, "Accepting internal peer forward");

    tokio::spawn(async move {
        match hyper::upgrade::on(req).await {
            Ok(upgraded) => {
                let state = state.clone();
                if let Err(e) = crate::bridge_to_provider(
                    upgraded,
                    dest,
                    control,
                    node_id.clone(),
                    state,
                    authenticator,
                    "internal-forward".to_string(),
                    None,
                    0,
                )
                .await
                {
                    error!(node_id = %node_id, error = %e, "Internal forward bridge failed");
                }
            }
            Err(e) => error!("Internal forward upgrade failed: {}", e),
        }
    });

    let mut resp = Response::new(Full::new(Bytes::new()));
    *resp.status_mut() = StatusCode::SWITCHING_PROTOCOLS;
    crate::metrics::REQUEST_LATENCY_SECONDS
        .with_label_values(&["CONNECT", "101"])
        .observe(start.elapsed().as_secs_f64());
    Ok(resp)
}

/// Open a CONNECT tunnel to the owner pod (peer edge or tunnel tier) and bridge the buyer stream.
pub async fn bridge_via_peer(
    upgraded: hyper::upgrade::Upgraded,
    dest_addr: String,
    node_id: String,
    peer_base_url: String,
    gateway_secret: String,
) -> std::io::Result<(u64, u64)> {
    let (host, port) = parse_peer_http_endpoint(&peer_base_url)?;
    let peer_addr = format!("{host}:{port}");

    let mut peer = TcpStream::connect(&peer_addr).await?;
    let auth = gateway_basic_auth(&gateway_secret);
    let request = format!(
        "CONNECT {INTERNAL_FORWARD_HOST}:0 HTTP/1.1\r\n\
         Host: {INTERNAL_FORWARD_HOST}\r\n\
         {HDR_INTERNAL}: 1\r\n\
         {HDR_NODE_ID}: {node_id}\r\n\
         {HDR_DEST}: {dest_addr}\r\n\
         Proxy-Authorization: {auth}\r\n\
         Connection: keep-alive\r\n\
         \r\n"
    );
    peer.write_all(request.as_bytes()).await?;

    let mut buf = vec![0u8; 4096];
    let n = peer.read(&mut buf).await?;
    if n == 0 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::ConnectionRefused,
            "Peer closed before response",
        ));
    }
    let head = String::from_utf8_lossy(&buf[..n]);
    if !head.contains(" 101 ") && !head.contains(" 200 ") {
        return Err(std::io::Error::new(
            std::io::ErrorKind::ConnectionRefused,
            format!(
                "Peer rejected internal forward: {}",
                head.lines().next().unwrap_or("")
            ),
        ));
    }

    let mut client = TokioIo::new(upgraded);
    let (bytes_to_peer, bytes_from_peer) = tokio::io::copy_bidirectional(&mut client, &mut peer)
        .await
        .unwrap_or((0, 0));
    Ok((bytes_to_peer, bytes_from_peer))
}

/// Open a CONNECT tunnel to the owner pod and bridge a raw TCP client stream.
pub async fn bridge_tcp_via_peer(
    mut client: TcpStream,
    dest_addr: String,
    node_id: String,
    peer_base_url: String,
    gateway_secret: String,
) -> std::io::Result<(u64, u64)> {
    let mut peer = open_peer_tunnel(dest_addr, node_id, peer_base_url, gateway_secret).await?;
    let (bytes_to_peer, bytes_from_peer) = tokio::io::copy_bidirectional(&mut client, &mut peer)
        .await
        .unwrap_or((0, 0));
    Ok((bytes_to_peer, bytes_from_peer))
}

pub(crate) async fn open_peer_tunnel(
    dest_addr: String,
    node_id: String,
    peer_base_url: String,
    gateway_secret: String,
) -> std::io::Result<TcpStream> {
    let (host, port) = parse_peer_http_endpoint(&peer_base_url)?;
    let peer_addr = format!("{host}:{port}");

    let mut peer = TcpStream::connect(&peer_addr).await?;
    let auth = gateway_basic_auth(&gateway_secret);
    let request = format!(
        "CONNECT {INTERNAL_FORWARD_HOST}:0 HTTP/1.1\r\n\
         Host: {INTERNAL_FORWARD_HOST}\r\n\
         {HDR_INTERNAL}: 1\r\n\
         {HDR_NODE_ID}: {node_id}\r\n\
         {HDR_DEST}: {dest_addr}\r\n\
         Proxy-Authorization: {auth}\r\n\
         Connection: keep-alive\r\n\
         \r\n"
    );
    peer.write_all(request.as_bytes()).await?;

    let mut buf = vec![0u8; 4096];
    let n = peer.read(&mut buf).await?;
    if n == 0 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::ConnectionRefused,
            "Peer closed before response",
        ));
    }
    let head = String::from_utf8_lossy(&buf[..n]);
    if !head.contains(" 101 ") && !head.contains(" 200 ") {
        return Err(std::io::Error::new(
            std::io::ErrorKind::ConnectionRefused,
            format!(
                "Peer rejected internal forward: {}",
                head.lines().next().unwrap_or("")
            ),
        ));
    }

    Ok(peer)
}

fn parse_peer_http_endpoint(base: &str) -> std::io::Result<(String, u16)> {
    let trimmed = base.trim();
    let without_scheme = trimmed
        .strip_prefix("http://")
        .or_else(|| trimmed.strip_prefix("https://"))
        .unwrap_or(trimmed);
    let (host, port) = if let Some((h, p)) = without_scheme.rsplit_once(':') {
        (
            h.to_string(),
            p.parse::<u16>().map_err(|e| {
                std::io::Error::new(std::io::ErrorKind::InvalidInput, e.to_string())
            })?,
        )
    } else {
        (without_scheme.to_string(), 8090)
    };
    Ok((host, port))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_peer_url() {
        let (h, p) = parse_peer_http_endpoint("http://edge-b:18091").unwrap();
        assert_eq!(h, "edge-b");
        assert_eq!(p, 18091);
    }
}

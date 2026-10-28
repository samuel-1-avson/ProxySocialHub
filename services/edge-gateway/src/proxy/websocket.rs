//! WebSocket proxy handler (RFC 6455, P2-W6).
//!
//! Allows clients to tunnel TCP through the proxy using WebSocket framing.
//! Useful in environments that block raw TCP but permit WebSocket connections.
//!
//! # Protocol
//! 1. Client sends `GET /ws?target=host:port HTTP/1.1` with WebSocket headers.
//! 2. Proxy authenticates via `Proxy-Authorization: Basic …`.
//! 3. Proxy responds `101 Switching Protocols`.
//! 4. Client sends target data as **binary** WebSocket frames.
//! 5. Proxy forwards frames as raw bytes through a yamux stream to the provider.
//! 6. Provider → proxy bytes are wrapped in binary frames back to client.
//!
//! WebSocket Ping frames are answered with Pong; Close frames terminate cleanly.

use base64::Engine;
use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use http_body_util::Full;
use hyper::{body::Incoming, header::PROXY_AUTHORIZATION, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use sha1::{Digest, Sha1};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_tungstenite::{
    tungstenite::protocol::{Message, Role},
    WebSocketStream,
};
use tokio_util::compat::FuturesAsyncReadCompatExt;
use tracing::{error, info, warn};

use crate::auth::{SessionAuthenticator, SessionData};
use crate::metrics;
use crate::policy;
use crate::proxy::destination_guard::{self, Refusal};
use crate::state::{AppState, SessionConnGuard};

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/// Returns `true` if `req` is a WebSocket upgrade request (RFC 6455 §4.2.1).
pub fn is_websocket<B>(req: &Request<B>) -> bool {
    let h = req.headers();
    let upgrade_ok = h
        .get(hyper::header::UPGRADE)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.to_lowercase() == "websocket")
        .unwrap_or(false);
    let has_key = h.contains_key("sec-websocket-key");
    upgrade_ok && has_key
}

// ---------------------------------------------------------------------------
// Handshake helpers
// ---------------------------------------------------------------------------

/// Compute the `Sec-WebSocket-Accept` header value (RFC 6455 §4.2.2).
fn ws_accept_key(client_key: &str) -> String {
    const GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    let mut sha = Sha1::new();
    sha.update(format!("{}{}", client_key, GUID).as_bytes());
    base64::engine::general_purpose::STANDARD.encode(sha.finalize())
}

/// Parse `?target=host:port` from the request URI query string.
fn parse_target(query: Option<&str>) -> Option<String> {
    query?.split('&').find_map(|pair| {
        let (key, val) = pair.split_once('=')?;

        if key == "target" {
            Some(val.to_string())
        } else {
            None
        }
    })
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/// Handle an incoming WebSocket upgrade request.
///
/// Returns a `101 Switching Protocols` response immediately; the actual
/// bridging is driven in a Tokio-spawned background task so the HTTP
/// connection remains non-blocking.
pub async fn handle_ws_upgrade(
    req: Request<Incoming>,
    state: Arc<AppState>,
    authenticator: Arc<SessionAuthenticator>,
) -> Result<Response<Full<Bytes>>, hyper::Error> {
    // 1. Extract target host:port
    let target = match parse_target(req.uri().query()) {
        Some(t) => t,
        None => {
            warn!("WS upgrade missing ?target= param");
            let mut resp = Response::new(Full::new(Bytes::from(
                "Missing ?target=host:port query param",
            )));
            *resp.status_mut() = StatusCode::BAD_REQUEST;
            return Ok(resp);
        }
    };

    // 2. Authenticate (same Proxy-Authorization as CONNECT)
    let auth_header = req.headers().get(PROXY_AUTHORIZATION);
    let (username, session_data) = match crate::extract_proxy_auth(auth_header) {
        Some((u, p)) => match authenticator
            .resolve_proxy_auth(&u, &p, &state.config.session_intent_signing_secret)
            .await
        {
            Ok(Some(resolved)) => {
                metrics::ACTIVE_SESSIONS.inc();
                (resolved.username, resolved.session)
            }
            Ok(None) => {
                warn!("WS: invalid session for {}", u);
                metrics::record_auth_failure("invalid_or_expired");
                let mut resp = Response::new(Full::new(Bytes::from("Proxy session invalid")));
                *resp.status_mut() = StatusCode::PROXY_AUTHENTICATION_REQUIRED;
                resp.headers_mut().insert(
                    "Proxy-Authenticate",
                    hyper::header::HeaderValue::from_static("Basic realm=\"ProxyHub\""),
                );
                return Ok(resp);
            }
            Err(e) => {
                error!("WS: auth backend error: {}", e);
                metrics::record_auth_failure("auth_backend_error");
                let mut resp = Response::new(Full::new(Bytes::from(
                    "Authentication service temporarily unavailable. Please retry.",
                )));
                *resp.status_mut() = StatusCode::PROXY_AUTHENTICATION_REQUIRED;
                resp.headers_mut().insert(
                    "Proxy-Authenticate",
                    hyper::header::HeaderValue::from_static("Basic realm=\"ProxyHub\""),
                );
                return Ok(resp);
            }
        },
        None => {
            warn!("WS: no credentials provided");
            metrics::record_auth_failure("missing_credentials");
            let mut resp = Response::new(Full::new(Bytes::from("Proxy authentication required")));
            *resp.status_mut() = StatusCode::PROXY_AUTHENTICATION_REQUIRED;
            resp.headers_mut().insert(
                "Proxy-Authenticate",
                hyper::header::HeaderValue::from_static("Basic realm=\"ProxyHub\""),
            );
            return Ok(resp);
        }
    };

    // 2b. Everything that can refuse the tunnel runs BEFORE the 101, so a refusal is a real
    // HTTP error and nothing reaches a provider unchecked (DP-CRIT-01). Until now this path
    // skipped destination policy, node rules, concurrency limits and metering, so a buyer
    // could tunnel to forbidden ports or private addresses for free.
    let admission = match admit_ws_connection(
        &target,
        &username,
        &session_data,
        &state,
        &authenticator,
    )
    .await
    {
        Ok(admission) => admission,
        Err(refusal) => {
            warn!(
                "WS refused for {} -> {}: {} ({})",
                username, target, refusal.body, refusal.status
            );
            refusal.record();
            metrics::ACTIVE_SESSIONS.dec();
            return Ok(refusal.into_response());
        }
    };

    // 3. Compute accept key and build 101 response
    let ws_key = req
        .headers()
        .get("sec-websocket-key")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let accept = ws_accept_key(&ws_key);

    let response = Response::builder()
        .status(StatusCode::SWITCHING_PROTOCOLS)
        .header(hyper::header::UPGRADE, "websocket")
        .header(hyper::header::CONNECTION, "Upgrade")
        .header("Sec-WebSocket-Accept", accept)
        .body(Full::new(Bytes::new()))
        .unwrap();

    // 4. Spawn bridge task — runs after hyper upgrades the connection
    let auth_clone = authenticator.clone();
    tokio::spawn(async move {
        // Held until the tunnel closes, then releases the session's concurrency slot.
        let WsAdmission {
            control,
            node_id,
            conn_guard: _conn_guard,
        } = admission;
        match hyper::upgrade::on(req).await {
            Ok(upgraded) => {
                let io = TokioIo::new(upgraded);
                let ws = WebSocketStream::from_raw_socket(io, Role::Server, None).await;
                match bridge_ws(
                    ws,
                    &target,
                    &username,
                    session_data,
                    state.clone(),
                    auth_clone.clone(),
                    control,
                    &node_id,
                )
                .await
                {
                    Ok(stats) => {
                        // Meter the bytes exactly as the CONNECT path does, so WebSocket
                        // tunnels are billed and counted against the session.
                        state
                            .usage_tracker
                            .record(
                                &username,
                                stats.bytes_from_client,
                                stats.bytes_from_provider,
                            )
                            .await;
                        let total = stats.bytes_from_client + stats.bytes_from_provider;
                        if let Err(e) = auth_clone.report_usage(&username, total as i64).await {
                            error!("WS: failed to report usage for {}: {}", username, e);
                        }
                        metrics::record_provider_bandwidth(
                            &node_id,
                            stats.bytes_from_client,
                            stats.bytes_from_provider,
                        );
                        metrics::connection_ended(
                            stats.bytes_from_client,
                            stats.bytes_from_provider,
                        );
                        metrics::ACTIVE_SESSIONS.dec();
                        info!(
                            "✅ WS bridge closed: {}/{} bytes up/down for {}",
                            stats.bytes_from_client, stats.bytes_from_provider, username
                        );
                    }
                    Err(e) => {
                        error!("WS bridge error for {}: {}", username, e);
                        metrics::record_connection_error("websocket");
                        metrics::ACTIVE_SESSIONS.dec();
                    }
                }
            }
            Err(e) => {
                error!("WS upgrade failed for {}: {}", username, e);
                metrics::record_connection_error("ws_upgrade");
                metrics::ACTIVE_SESSIONS.dec();
            }
        }
    });

    Ok(response)
}

// ---------------------------------------------------------------------------
// Bridging
// ---------------------------------------------------------------------------

/// Return type for bridge stats (mirrors zerocopy::BridgeStats).
pub struct WsBridgeStats {
    pub bytes_from_client: u64,
    pub bytes_from_provider: u64,
}

/// What `admit_ws_connection` hands to the bridge: the chosen provider and the session's
/// concurrency slot, which is released when the tunnel ends.
struct WsAdmission {
    control: yamux::Control,
    node_id: String,
    conn_guard: SessionConnGuard,
}

/// Run every check that can refuse a WebSocket tunnel and pick the provider, before the
/// `101` is sent. Mirrors the CONNECT path: destination policy and DNS check, session
/// domain and time rules, per-session concurrency and per-user rate limits, provider node
/// rules, and the session-escrow preflight before any provider stream is opened.
async fn admit_ws_connection(
    target: &str,
    username: &str,
    session: &SessionData,
    state: &Arc<AppState>,
    authenticator: &Arc<SessionAuthenticator>,
) -> Result<WsAdmission, Refusal> {
    destination_guard::check_destination(target)?;
    destination_guard::check_destination_dns(target).await?;
    destination_guard::check_session_rules(target, session)?;

    let conn_guard = state
        .session_conns
        .acquire(username, session.max_concurrency)
        .ok_or_else(|| {
            warn!("WS: session concurrency limit reached for {}", username);
            metrics::record_rate_limit_hit("session_concurrency");
            Refusal::plain(
                StatusCode::TOO_MANY_REQUESTS,
                "Session concurrency limit reached",
            )
        })?;
    if !state.check_rate_limit(username) {
        warn!("WS: rate limit exceeded for {}", username);
        metrics::record_rate_limit_hit("connection_rate");
        return Err(Refusal::plain(
            StatusCode::TOO_MANY_REQUESTS,
            "Rate limit exceeded",
        ));
    }

    // Provider selection keeps the previous behaviour (best local node for the session's
    // geo); sticky, pinned and ISP routing for WebSocket is part of the Phase 4 unification.
    let geo = if session.target_geo.is_empty() {
        None
    } else {
        Some(session.target_geo.as_str())
    };
    let (control, node_id) = state.registry.get_best_for(geo, None).ok_or_else(|| {
        warn!("No providers available for WS bridge to {}", target);
        metrics::record_connection_error("no_providers");
        Refusal::plain(
            StatusCode::SERVICE_UNAVAILABLE,
            "No healthy providers available",
        )
    })?;

    // N-01: the chosen provider's own port and domain rules.
    if let Some(node_cfg) = authenticator.get_node_config(&node_id).await {
        destination_guard::check_node_rules(target, &node_cfg)?;
    }

    // Escrow-backed sessions must be funded before a provider stream is opened.
    if let Err(err) = crate::ensure_session_intent_may_activate(
        state.clone(),
        session,
        Some(node_id.as_str()),
        Some(policy::target_host_from_endpoint(target)),
    )
    .await
    {
        if matches!(err, crate::error::Error::SessionEscrowRequired(_)) {
            return Err(Refusal::plain(
                StatusCode::PAYMENT_REQUIRED,
                "Session escrow required",
            ));
        }
    }

    Ok(WsAdmission {
        control,
        node_id,
        conn_guard,
    })
}

/// Bridge a WebSocket connection to a TCP target via the provider yamux tunnel.
///
/// Errors before the tunnel is established are returned. Once data is flowing, a failure
/// ends the loop but the bytes moved so far are still returned, so they are metered.
#[allow(clippy::too_many_arguments)]
async fn bridge_ws<S>(
    ws: WebSocketStream<S>,
    target: &str,
    username: &str,
    session_data: SessionData,
    state: Arc<AppState>,
    authenticator: Arc<SessionAuthenticator>,
    mut control: yamux::Control,
    node_id: &str,
) -> std::io::Result<WsBridgeStats>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    // Open yamux stream and convert to tokio-compatible I/O
    let raw_stream = control
        .open_stream()
        .await
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::ConnectionRefused, e))?;
    let mut tcp = raw_stream.compat();

    // Send CONNECT command to provider agent (pre-sized — same as HTTP CONNECT hot path)
    let mut command = String::with_capacity(9 + target.len());
    command.push_str("CONNECT ");
    command.push_str(target);
    command.push('\n');
    tcp.write_all(command.as_bytes()).await?;

    // Wait for OK
    let mut resp_buf = [0u8; 64];
    let n = tcp.read(&mut resp_buf).await?;
    let resp = String::from_utf8_lossy(&resp_buf[..n]);
    if !resp.starts_with("OK") {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            format!("Provider refused for WS target {}: {}", target, resp.trim()),
        ));
    }

    // Policy, node rules and the session-escrow preflight already ran in
    // admit_ws_connection, before this stream was opened.
    info!("🔗 WS bridge: {} → {} via {}", username, target, node_id);
    metrics::connection_started();

    // Split WS into independent sink + stream halves
    let (mut ws_sink, mut ws_stream) = ws.split();

    let mut bytes_from_client = 0u64;
    let mut bytes_from_provider = 0u64;
    let mut last_reval_total = 0u64;
    let mut last_usage_synced_up = 0u64;
    let mut last_usage_synced_down = 0u64;
    const REVAL_THRESHOLD: u64 = 100 * 1024 * 1024; // 100 MB

    let mut tcp_buf = vec![0u8; 65536];

    loop {
        tokio::select! {
            // Client → provider
            msg = ws_stream.next() => {
                match msg {
                    Some(Ok(Message::Binary(data))) => {
                        // A write error ends the loop instead of returning, so the bytes
                        // moved so far are still metered by the caller.
                        if let Err(e) = tcp.write_all(&data).await {
                            error!("WS: provider write error for {}: {}", username, e);
                            break;
                        }
                        bytes_from_client += data.len() as u64;
                    }
                    Some(Ok(Message::Text(text))) => {
                        if let Err(e) = tcp.write_all(text.as_bytes()).await {
                            error!("WS: provider write error for {}: {}", username, e);
                            break;
                        }
                        bytes_from_client += text.len() as u64;
                    }
                    Some(Ok(Message::Ping(data))) => {
                        // Reply with Pong to keep the WS connection alive
                        ws_sink.send(Message::Pong(data)).await.ok();
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(e)) => {
                        error!("WS recv error for {}: {}", username, e);
                        break;
                    }
                    Some(Ok(_)) => {} // Pong, continuation — ignore
                }
            }
            // Provider → client
            result = tcp.read(&mut tcp_buf) => {
                match result {
                    Ok(0) => break,
                    Ok(n) => {
                        let frame = Message::Binary(tcp_buf[..n].to_vec());
                        if ws_sink.send(frame).await.is_err() {
                            break;
                        }
                        bytes_from_provider += n as u64;
                    }
                    Err(e) => {
                        error!("TCP read error for {}: {}", username, e);
                        break;
                    }
                }
            }
        }

        // Bandwidth-limit enforcement every 100 MB
        let total = bytes_from_client + bytes_from_provider;
        if total - last_reval_total >= REVAL_THRESHOLD {
            last_reval_total = total;
            crate::sync_session_intent_usage(
                state.clone(),
                &session_data,
                Some(node_id),
                Some(target),
                bytes_from_client.saturating_sub(last_usage_synced_up),
                bytes_from_provider.saturating_sub(last_usage_synced_down),
            )
            .await;
            last_usage_synced_up = bytes_from_client;
            last_usage_synced_down = bytes_from_provider;
            if !crate::auth::revalidate_live_session(&authenticator, username, &session_data).await
            {
                if session_data.is_session_intent() {
                    let _ = crate::sync_session_intent_lifecycle(
                        state.clone(),
                        &session_data,
                        "closing",
                        Some(node_id),
                        Some(target),
                    )
                    .await;
                }
                warn!("🛑 WS session {} limit reached. Terminating.", username);
                break;
            }
        }
    }

    crate::finalize_session_intent_ledger(
        state,
        &session_data,
        Some(node_id),
        Some(target),
        bytes_from_client.saturating_sub(last_usage_synced_up),
        bytes_from_provider.saturating_sub(last_usage_synced_down),
    )
    .await;

    ws_sink.close().await.ok();
    Ok(WsBridgeStats {
        bytes_from_client,
        bytes_from_provider,
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_websocket_false_for_plain_request() {
        let req = hyper::Request::builder()
            .method("GET")
            .uri("/")
            .body(())
            .unwrap();
        assert!(!is_websocket(&req));
    }

    #[test]
    fn test_ws_accept_key() {
        // RFC 6455 §4.2.2 example
        let key = "dGhlIHNhbXBsZSBub25jZQ==";
        let expected = "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=";
        assert_eq!(ws_accept_key(key), expected);
    }

    #[test]
    fn test_parse_target_basic() {
        assert_eq!(
            parse_target(Some("target=example.com:443")),
            Some("example.com:443".to_string())
        );
    }

    #[test]
    fn test_parse_target_with_other_params() {
        assert_eq!(
            parse_target(Some("foo=bar&target=proxy.test:8080&baz=1")),
            Some("proxy.test:8080".to_string())
        );
    }

    #[test]
    fn test_parse_target_missing() {
        assert_eq!(parse_target(Some("foo=bar")), None);
        assert_eq!(parse_target(None), None);
    }
}

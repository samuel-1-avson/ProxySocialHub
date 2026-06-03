//! HTTP/3 buyer ingress (P6).
//!
//! Implements HTTP/3 CONNECT over QUIC using h3 + Quinn. The first pass is
//! deliberately scoped to TCP CONNECT tunnels, matching the existing HTTP/1.1,
//! HTTP/2, and SOCKS5 ingress surfaces.

use std::{net::SocketAddr, sync::Arc, time::Instant};

use bytes::{Buf, Bytes};
use futures_util::{AsyncReadExt as FuturesAsyncReadExt, AsyncWriteExt as FuturesAsyncWriteExt};
use h3::server::RequestStream;
use hyper::header::PROXY_AUTHORIZATION;
use hyper::{Method, Response, StatusCode};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_util::compat::FuturesAsyncReadCompatExt;
use tracing::{debug, error, info, warn};
use yamux::Control;

use crate::{
    auth::{SessionAuthenticator, SessionData},
    metrics, policy,
    registry::provider_selection::{self, ProviderTarget},
    state::AppState,
};

type H3Stream = RequestStream<h3_quinn::BidiStream<Bytes>, Bytes>;

pub fn enabled() -> bool {
    std::env::var("ENABLE_HTTP3_INGRESS")
        .ok()
        .map(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(false)
}

pub fn listen_addr(default_host: &str) -> std::io::Result<SocketAddr> {
    let host = std::env::var("HTTP3_HOST").unwrap_or_else(|_| default_host.to_string());
    let port = std::env::var("HTTP3_PORT")
        .unwrap_or_else(|_| "8443".to_string())
        .parse::<u16>()
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidInput, e.to_string()))?;
    format!("{host}:{port}")
        .parse()
        .map_err(|e: std::net::AddrParseError| std::io::Error::new(std::io::ErrorKind::InvalidInput, e))
}

pub async fn run_server(
    addr: SocketAddr,
    state: Arc<AppState>,
    authenticator: Arc<SessionAuthenticator>,
) -> anyhow::Result<()> {
    let tls_config = crate::tls::http3_tls_config_from_env().ok_or_else(|| {
        anyhow::anyhow!(
            "ENABLE_HTTP3_INGRESS requires HTTP3_TLS_CERT_FILE/KEY, BUYER_TLS_CERT_FILE/KEY, or TLS_CERT_FILE/KEY"
        )
    })?;
    let server_config = crate::tls::create_http3_quic_server_config(&tls_config)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let endpoint = quinn::Endpoint::server(server_config, addr)?;
    info!(%addr, "HTTP/3 ingress listening");

    while let Some(incoming) = endpoint.accept().await {
        let state = state.clone();
        let authenticator = authenticator.clone();
        tokio::spawn(async move {
            match incoming.await {
                Ok(conn) => {
                    if let Err(e) = handle_quic_connection(conn, state, authenticator).await {
                        debug!(error = %e, "HTTP/3 connection ended");
                    }
                }
                Err(e) => error!(error = %e, "HTTP/3 QUIC accept failed"),
            }
        });
    }

    Ok(())
}

async fn handle_quic_connection(
    conn: quinn::Connection,
    state: Arc<AppState>,
    authenticator: Arc<SessionAuthenticator>,
) -> anyhow::Result<()> {
    let mut builder = h3::server::builder();
    builder.enable_extended_connect(true);
    let mut h3_conn = builder.build(h3_quinn::Connection::new(conn)).await?;

    loop {
        match h3_conn.accept().await {
            Ok(Some(resolver)) => {
                let state = state.clone();
                let authenticator = authenticator.clone();
                tokio::spawn(async move {
                    match resolver.resolve_request().await {
                        Ok((req, stream)) => {
                            if let Err(e) = handle_request(req, stream, state, authenticator).await
                            {
                                debug!(error = %e, "HTTP/3 request failed");
                            }
                        }
                        Err(e) => debug!(error = %e, "HTTP/3 request resolution failed"),
                    }
                });
            }
            Ok(None) => return Ok(()),
            Err(e) => return Err(e.into()),
        }
    }
}

async fn handle_request(
    req: hyper::http::Request<()>,
    mut stream: H3Stream,
    state: Arc<AppState>,
    authenticator: Arc<SessionAuthenticator>,
) -> anyhow::Result<()> {
    let start = Instant::now();
    metrics::connection_started();

    let result = async {
        if req.method() != Method::CONNECT {
            send_empty_response(&mut stream, StatusCode::METHOD_NOT_ALLOWED).await?;
            return Err(anyhow::anyhow!("HTTP/3 ingress only supports CONNECT"));
        }
        if !state.config.serves_buyer_connect() {
            metrics::record_policy_block("tunnel_tier_h3");
            send_empty_response(&mut stream, StatusCode::FORBIDDEN).await?;
            return Err(anyhow::anyhow!("HTTP/3 CONNECT disabled on tunnel tier"));
        }

        let Some((username, password)) =
            crate::extract_proxy_auth(req.headers().get(PROXY_AUTHORIZATION))
        else {
            metrics::record_auth_failure("h3_missing_credentials");
            send_empty_response(&mut stream, StatusCode::PROXY_AUTHENTICATION_REQUIRED).await?;
            return Err(anyhow::anyhow!("missing HTTP/3 proxy credentials"));
        };

        let resolved = match authenticator
            .resolve_proxy_auth(
                &username,
                &password,
                &state.config.session_intent_signing_secret,
            )
            .await
        {
            Ok(Some(resolved)) => resolved,
            Ok(None) => {
                metrics::record_auth_failure("h3_invalid_or_expired");
                send_empty_response(&mut stream, StatusCode::PROXY_AUTHENTICATION_REQUIRED).await?;
                return Err(anyhow::anyhow!("invalid HTTP/3 proxy credentials"));
            }
            Err(e) => {
                metrics::record_auth_failure("h3_auth_backend_error");
                send_empty_response(&mut stream, StatusCode::PROXY_AUTHENTICATION_REQUIRED).await?;
                return Err(anyhow::anyhow!(e.to_string()));
            }
        };

        let addr = h3_connect_authority(&req).ok_or_else(|| anyhow::anyhow!("missing authority"))?;
        if let Err(reason) = policy::validate_destination(&addr) {
            metrics::record_policy_block(&reason);
            send_empty_response(&mut stream, StatusCode::FORBIDDEN).await?;
            return Err(anyhow::anyhow!(reason));
        }

        validate_session_policy(&resolved.username, &resolved.session, &addr, &state)?;
        let dest_host = policy::target_host_from_endpoint(&addr);

        if let Some(token_type) = state.honeytoken.check(dest_host) {
            warn!(
                session_id = %resolved.session.session_id,
                ?token_type,
                dest = %dest_host,
                "HTTP/3 honeytoken hit"
            );
            metrics::record_policy_block("honeytoken_hit");
            metrics::record_honeytoken_hit("unknown");
            send_empty_response(&mut stream, StatusCode::FORBIDDEN).await?;
            return Err(anyhow::anyhow!("honeytoken hit"));
        }

        let target_geo = if resolved.session.target_geo.is_empty() {
            None
        } else {
            Some(resolved.session.target_geo.as_str())
        };
        let is_sticky = resolved.session.session_type == "sticky";
        let route = provider_selection::select_provider_route(
            state.clone(),
            &resolved.session.session_id,
            is_sticky,
            authenticator.clone(),
            target_geo,
            Some(dest_host),
        )
        .await?;

        let Some(route) = route else {
            metrics::record_connection_error("h3_no_providers");
            send_empty_response(&mut stream, StatusCode::SERVICE_UNAVAILABLE).await?;
            return Err(anyhow::anyhow!("No healthy providers available"));
        };

        let node_id = match &route {
            ProviderTarget::Local { node_id, .. } => node_id.clone(),
            ProviderTarget::Remote { node_id, .. } => node_id.clone(),
        };
        validate_node_policy(&authenticator, &node_id, &addr).await?;

        let (bytes_up, bytes_down) = match route {
            ProviderTarget::Local { control, node_id } => {
                bridge_local_provider(stream, addr.clone(), control, node_id, state.clone()).await?
            }
            ProviderTarget::Remote {
                node_id,
                peer_base_url,
            } => {
                let peer = crate::internal_forward::open_peer_tunnel(
                    addr.clone(),
                    node_id,
                    peer_base_url,
                    state.config.gateway_shared_secret.clone(),
                )
                .await?;
                bridge_peer_stream(stream, peer).await?
            }
        };

        record_successful_usage(
            state.clone(),
            &authenticator,
            &resolved.username,
            &resolved.session,
            &node_id,
            dest_host,
            bytes_up,
            bytes_down,
        )
        .await;
        metrics::REQUEST_LATENCY_SECONDS
            .with_label_values(&["HTTP3", "200"])
            .observe(start.elapsed().as_secs_f64());
        Ok(())
    }
    .await;

    if result.is_err() {
        metrics::record_connection_error("h3");
        metrics::REQUEST_LATENCY_SECONDS
            .with_label_values(&["HTTP3", "error"])
            .observe(start.elapsed().as_secs_f64());
    }
    metrics::connection_ended(0, 0);
    result
}

fn h3_connect_authority(req: &hyper::http::Request<()>) -> Option<String> {
    req.uri()
        .authority()
        .map(|a| a.as_str().to_string())
        .or_else(|| {
            let raw = req.uri().to_string();
            if raw.contains(':') {
                Some(raw)
            } else {
                None
            }
        })
}

fn validate_session_policy(
    username: &str,
    session: &SessionData,
    addr: &str,
    state: &AppState,
) -> anyhow::Result<()> {
    let dest_host = policy::target_host_from_endpoint(addr);
    if policy::host_matches_any_domain_rule(dest_host, &session.blocked_domains) {
        metrics::record_policy_block("session_blocked_domain");
        return Err(anyhow::anyhow!("Destination blocked by session policy"));
    }
    if !session.allowed_domains.is_empty()
        && !policy::host_matches_any_domain_rule(dest_host, &session.allowed_domains)
    {
        metrics::record_policy_block("session_domain_not_whitelisted");
        return Err(anyhow::anyhow!("Destination not in session allowlist"));
    }
    if !session.session_within_time_limit() {
        metrics::record_auth_failure("session_time_limit");
        return Err(anyhow::anyhow!("Proxy session expired"));
    }
    if !state.check_rate_limit(username) {
        metrics::record_rate_limit_hit("h3_connection_rate");
        return Err(anyhow::anyhow!("Rate limit exceeded"));
    }
    if state.anomaly.record_request(&session.session_id) {
        metrics::record_policy_block("anomaly_high_rpm");
        return Err(anyhow::anyhow!("Session anomaly limit exceeded"));
    }
    Ok(())
}

async fn validate_node_policy(
    authenticator: &SessionAuthenticator,
    node_id: &str,
    addr: &str,
) -> anyhow::Result<()> {
    let Some(ncfg) = authenticator.get_node_config(node_id).await else {
        return Ok(());
    };
    let dest_host = policy::target_host_from_endpoint(addr);
    let dest_port = policy::parse_port(addr).unwrap_or(443) as i64;
    if ncfg.blocked_ports.contains(&dest_port) {
        metrics::record_policy_block("node_blocked_port");
        return Err(anyhow::anyhow!("Destination port blocked by provider policy"));
    }
    if !ncfg.allowed_ports.is_empty() && !ncfg.allowed_ports.contains(&dest_port) {
        metrics::record_policy_block("node_port_not_whitelisted");
        return Err(anyhow::anyhow!("Destination port not allowed by provider policy"));
    }
    if policy::host_matches_any_domain_rule(dest_host, &ncfg.blocked_domains) {
        metrics::record_policy_block("node_blocked_domain");
        return Err(anyhow::anyhow!(
            "Destination domain blocked by provider policy"
        ));
    }
    if !ncfg.allowed_domains.is_empty()
        && !policy::host_matches_any_domain_rule(dest_host, &ncfg.allowed_domains)
    {
        metrics::record_policy_block("node_domain_not_whitelisted");
        return Err(anyhow::anyhow!(
            "Destination domain not allowed by provider policy"
        ));
    }
    Ok(())
}

async fn bridge_local_provider(
    mut stream: H3Stream,
    addr: String,
    mut control: Control,
    node_id: String,
    state: Arc<AppState>,
) -> anyhow::Result<(u64, u64)> {
    let connect_timeout = std::time::Duration::from_secs(state.config.proxy_connect_timeout_secs);
    let mut provider = tokio::time::timeout(connect_timeout, control.open_stream())
        .await
        .map_err(|_| anyhow::anyhow!("yamux stream open timed out"))??;

    let command = format!("CONNECT {addr}\n");
    provider.write_all(command.as_bytes()).await?;

    let mut response_buf = [0u8; 64];
    let n = tokio::time::timeout(connect_timeout, provider.read(&mut response_buf))
        .await
        .map_err(|_| anyhow::anyhow!("provider CONNECT timed out"))??;
    let response = String::from_utf8_lossy(&response_buf[..n]);
    if !response.starts_with("OK") {
        send_empty_response(&mut stream, StatusCode::BAD_GATEWAY).await?;
        return Err(anyhow::anyhow!("Provider refused: {}", response.trim()));
    }

    send_ok_response(&mut stream).await?;
    let provider = provider.compat();
    let stats = bridge_h3_to_async_io(stream, provider).await?;
    debug!(%node_id, %addr, bytes_up = stats.0, bytes_down = stats.1, "HTTP/3 local provider bridge ended");
    Ok(stats)
}

async fn bridge_peer_stream(mut stream: H3Stream, peer: tokio::net::TcpStream) -> anyhow::Result<(u64, u64)> {
    send_ok_response(&mut stream).await?;
    bridge_h3_to_async_io(stream, peer).await
}

async fn bridge_h3_to_async_io<T>(stream: H3Stream, io: T) -> anyhow::Result<(u64, u64)>
where
    T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let (mut h3_send, mut h3_recv) = stream.split();
    let (mut io_read, mut io_write) = tokio::io::split(io);

    let to_provider = async {
        let mut bytes_up = 0u64;
        while let Some(mut chunk) = h3_recv.recv_data().await? {
            let len = chunk.remaining();
            let bytes = chunk.copy_to_bytes(len);
            io_write.write_all(&bytes).await?;
            bytes_up = bytes_up.saturating_add(len as u64);
        }
        let _ = io_write.shutdown().await;
        anyhow::Ok(bytes_up)
    };

    let to_client = async {
        let mut bytes_down = 0u64;
        let mut buf = vec![0u8; 16 * 1024];
        loop {
            let n = io_read.read(&mut buf).await?;
            if n == 0 {
                break;
            }
            h3_send
                .send_data(Bytes::copy_from_slice(&buf[..n]))
                .await?;
            bytes_down = bytes_down.saturating_add(n as u64);
        }
        let _ = h3_send.finish().await;
        anyhow::Ok(bytes_down)
    };

    let (bytes_up, bytes_down) = tokio::try_join!(to_provider, to_client)?;
    Ok((bytes_up, bytes_down))
}

async fn send_empty_response(stream: &mut H3Stream, status: StatusCode) -> anyhow::Result<()> {
    stream
        .send_response(Response::builder().status(status).body(())?)
        .await?;
    stream.finish().await?;
    Ok(())
}

async fn send_ok_response(stream: &mut H3Stream) -> anyhow::Result<()> {
    stream
        .send_response(Response::builder().status(StatusCode::OK).body(())?)
        .await?;
    Ok(())
}

async fn record_successful_usage(
    state: Arc<AppState>,
    authenticator: &SessionAuthenticator,
    username: &str,
    session: &SessionData,
    node_id: &str,
    dest_host: &str,
    bytes_up: u64,
    bytes_down: u64,
) {
    let total_bytes = bytes_up.saturating_add(bytes_down);
    state.usage_tracker.record(username, bytes_up, bytes_down).await;
    metrics::record_provider_bandwidth(node_id, bytes_up, bytes_down);
    metrics::record_bandwidth(bytes_up, bytes_down);
    if let Err(e) = authenticator.report_usage(username, total_bytes as i64).await {
        error!(error = %e, %username, "Failed to report HTTP/3 usage");
    }
    crate::finalize_session_intent_ledger(
        state,
        session,
        Some(node_id),
        Some(dest_host),
        bytes_up,
        bytes_down,
    )
    .await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn listen_addr_uses_http3_defaults() {
        std::env::remove_var("HTTP3_HOST");
        std::env::remove_var("HTTP3_PORT");
        assert_eq!(
            listen_addr("127.0.0.1").unwrap(),
            "127.0.0.1:8443".parse::<SocketAddr>().unwrap()
        );
    }

    #[test]
    fn h3_connect_authority_reads_authority_form() {
        let req = hyper::http::Request::builder()
            .method(Method::CONNECT)
            .uri("example.com:443")
            .body(())
            .unwrap();
        assert_eq!(
            h3_connect_authority(&req),
            Some("example.com:443".to_string())
        );
    }

    #[test]
    fn h3_connect_authority_rejects_origin_form() {
        let req = hyper::http::Request::builder()
            .method(Method::GET)
            .uri("/")
            .body(())
            .unwrap();
        assert_eq!(h3_connect_authority(&req), None);
    }
}

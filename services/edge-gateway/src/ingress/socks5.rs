//! SOCKS5 buyer ingress (P6).
//!
//! Supports username/password auth and CONNECT. UDP ASSOCIATE and BIND are
//! intentionally not implemented because the provider tunnel is TCP-oriented.

use std::{io, net::SocketAddr, sync::Arc, time::Instant};

use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};
use tokio_util::compat::FuturesAsyncReadCompatExt;
use tracing::{debug, error, info, warn, Instrument};

use crate::{
    auth::{SessionAuthenticator, SessionData},
    metrics, policy,
    registry::provider_selection::{self, ProviderTarget},
    security::honeytoken::sink::handle_malicious_connection,
    state::AppState,
};

const SOCKS_VERSION: u8 = 0x05;
const METHOD_USERNAME_PASSWORD: u8 = 0x02;
const METHOD_NO_ACCEPTABLE: u8 = 0xff;
const AUTH_VERSION: u8 = 0x01;
const CMD_CONNECT: u8 = 0x01;

const REP_SUCCEEDED: u8 = 0x00;
const REP_GENERAL_FAILURE: u8 = 0x01;
const REP_RULESET_DENIED: u8 = 0x02;
const REP_NETWORK_UNREACHABLE: u8 = 0x03;
const REP_HOST_UNREACHABLE: u8 = 0x04;
const REP_COMMAND_NOT_SUPPORTED: u8 = 0x07;
const REP_ADDRESS_TYPE_NOT_SUPPORTED: u8 = 0x08;

#[derive(Debug)]
struct SocksRequest {
    addr: String,
    host: String,
    port: u16,
}

struct AuthenticatedSession {
    username: String,
    session: SessionData,
}

pub fn enabled() -> bool {
    env_bool("ENABLE_SOCKS5", false)
        || std::env::var("SOCKS5_PORT")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .is_some()
}

pub fn listen_addr(default_host: &str) -> io::Result<SocketAddr> {
    let host = std::env::var("SOCKS5_HOST").unwrap_or_else(|_| default_host.to_string());
    let port = std::env::var("SOCKS5_PORT")
        .unwrap_or_else(|_| "1080".to_string())
        .parse::<u16>()
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e.to_string()))?;
    format!("{host}:{port}")
        .parse()
        .map_err(|e: std::net::AddrParseError| io::Error::new(io::ErrorKind::InvalidInput, e))
}

pub async fn run_server(
    addr: SocketAddr,
    state: Arc<AppState>,
    authenticator: Arc<SessionAuthenticator>,
) -> io::Result<()> {
    let listener = TcpListener::bind(addr).await?;
    info!(%addr, "SOCKS5 ingress listening");

    loop {
        let (stream, peer_addr) = listener.accept().await?;
        let state = state.clone();
        let authenticator = authenticator.clone();
        tokio::spawn(async move {
            let span = tracing::info_span!("socks5_session", peer = %peer_addr);
            if let Err(e) = handle_connection(stream, peer_addr, state, authenticator)
                .instrument(span)
                .await
            {
                debug!(error = %e, "SOCKS5 session ended");
            }
        });
    }
}

async fn handle_connection(
    mut client: TcpStream,
    peer_addr: SocketAddr,
    state: Arc<AppState>,
    authenticator: Arc<SessionAuthenticator>,
) -> io::Result<()> {
    let start = Instant::now();
    metrics::connection_started();

    let result = async {
        if !state.config.serves_buyer_connect() {
            metrics::record_policy_block("tunnel_tier_socks5");
            send_reply(&mut client, REP_RULESET_DENIED).await?;
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "SOCKS5 disabled on tunnel tier",
            ));
        }

        let auth = authenticate(&mut client, &state, &authenticator).await?;
        if !auth.session.target_geo.is_empty() {
            metrics::record_connection_by_country(&auth.session.target_geo);
        }

        let request = read_connect_request(&mut client).await?;
        let dest_host = request.host.as_str();

        if let Err(reason) = policy::validate_destination(&request.addr) {
            warn!(dest = %request.addr, reason = %reason, "SOCKS5 policy violation");
            metrics::record_policy_block(&reason);
            send_reply(&mut client, REP_RULESET_DENIED).await?;
            return Err(io::Error::new(io::ErrorKind::PermissionDenied, reason));
        }

        if let Err(e) = validate_session_policy(&auth, &request, &state).await {
            send_reply(&mut client, REP_RULESET_DENIED).await?;
            return Err(e);
        }

        // GW-03 / 1.2: per-session RPM (parity with HTTP CONNECT).
        if auth.session.requests_per_minute > 0 {
            match authenticator
                .check_rate_limit(
                    &auth.session.session_id,
                    auth.session.requests_per_minute as u32,
                )
                .await
            {
                Ok(true) => {}
                Ok(false) => {
                    metrics::record_rate_limit_hit("session_rpm");
                    send_reply(&mut client, REP_RULESET_DENIED).await?;
                    return Err(io::Error::new(
                        io::ErrorKind::PermissionDenied,
                        "Session requests-per-minute limit exceeded",
                    ));
                }
                Err(e) => {
                    metrics::record_rate_limit_hit("session_rpm");
                    send_reply(&mut client, REP_RULESET_DENIED).await?;
                    return Err(io::Error::new(
                        io::ErrorKind::PermissionDenied,
                        e.to_string(),
                    ));
                }
            }
        }

        // GW-03 / 1.2: per-session concurrency — hold guard for the SOCKS lifetime.
        let _conn_guard = match state
            .session_conns
            .acquire(&auth.username, auth.session.max_concurrency)
        {
            Some(g) => g,
            None => {
                metrics::record_rate_limit_hit("session_concurrency");
                send_reply(&mut client, REP_RULESET_DENIED).await?;
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "Session concurrency limit reached",
                ));
            }
        };

        if let Some(token_type) = state.honeytoken.check(dest_host) {
            warn!(
                session_id = %auth.session.session_id,
                ?token_type,
                dest = %dest_host,
                "SOCKS5 honeytoken hit"
            );
            metrics::record_policy_block("honeytoken_hit");
            metrics::record_honeytoken_hit("unknown");
            send_reply(&mut client, REP_SUCCEEDED).await?;
            return bridge_to_malicious_sink(client).await;
        }

        let target_geo = if auth.session.target_geo.is_empty() {
            None
        } else {
            Some(auth.session.target_geo.as_str())
        };
        let is_sticky = auth.session.session_type == "sticky";
        let pinned_node_id = if auth.session.node_id.is_empty() {
            None
        } else {
            Some(auth.session.node_id.as_str())
        };
        let target_isp = if auth.session.target_isp.is_empty() {
            None
        } else {
            Some(auth.session.target_isp.as_str())
        };
        let rotation_type = if auth.session.rotation_type.is_empty() {
            None
        } else {
            Some(auth.session.rotation_type.as_str())
        };
        let rotation_interval_seconds = if auth.session.rotation_interval_seconds == 0 {
            None
        } else {
            Some(auth.session.rotation_interval_seconds)
        };
        let route = match provider_selection::select_provider_route(
            state.clone(),
            &auth.session.session_id,
            is_sticky,
            authenticator.clone(),
            target_geo,
            Some(dest_host),
            pinned_node_id,
            target_isp,
            rotation_type,
            rotation_interval_seconds,
        )
        .await
        {
            Ok(route) => route,
            Err(e) => {
                send_reply(&mut client, REP_GENERAL_FAILURE).await?;
                return Err(e);
            }
        };

        let Some(route) = route else {
            metrics::record_connection_error("socks5_no_providers");
            send_reply(&mut client, REP_HOST_UNREACHABLE).await?;
            return Err(io::Error::new(
                io::ErrorKind::NotConnected,
                "No healthy providers available",
            ));
        };

        let node_id_for_metrics = match &route {
            ProviderTarget::Local { node_id, .. } => node_id.clone(),
            ProviderTarget::Remote { node_id, .. } => node_id.clone(),
        };
        if let Err(e) = validate_node_policy(&authenticator, &node_id_for_metrics, &request).await {
            send_reply(&mut client, REP_RULESET_DENIED).await?;
            return Err(e);
        }

        state
            .prewarm
            .record_connection(&node_id_for_metrics, current_utc_hour());

        let (bytes_up, bytes_down) = match route {
            ProviderTarget::Local { control, node_id } => {
                bridge_local_provider(
                    client,
                    request.addr.clone(),
                    control,
                    node_id,
                    state.clone(),
                )
                .await?
            }
            ProviderTarget::Remote {
                node_id,
                peer_base_url,
            } => {
                let mut peer = crate::internal_forward::open_peer_tunnel(
                    request.addr.clone(),
                    node_id.clone(),
                    peer_base_url,
                    state.config.gateway_shared_secret.clone(),
                )
                .await?;
                send_reply(&mut client, REP_SUCCEEDED).await?;
                tokio::io::copy_bidirectional(&mut client, &mut peer)
                    .await
                    .unwrap_or((0, 0))
            }
        };

        record_successful_usage(
            state.clone(),
            &authenticator,
            &auth,
            &node_id_for_metrics,
            dest_host,
            bytes_up,
            bytes_down,
        )
        .await;

        metrics::REQUEST_LATENCY_SECONDS
            .with_label_values(&["SOCKS5", "200"])
            .observe(start.elapsed().as_secs_f64());
        Ok(())
    }
    .await;

    if result.is_err() {
        metrics::record_connection_error("socks5");
        metrics::REQUEST_LATENCY_SECONDS
            .with_label_values(&["SOCKS5", "error"])
            .observe(start.elapsed().as_secs_f64());
    }
    metrics::connection_ended(0, 0);
    debug!(%peer_addr, "SOCKS5 connection closed");
    result
}

async fn authenticate(
    client: &mut TcpStream,
    state: &AppState,
    authenticator: &SessionAuthenticator,
) -> io::Result<AuthenticatedSession> {
    let mut head = [0u8; 2];
    client.read_exact(&mut head).await?;
    if head[0] != SOCKS_VERSION {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid SOCKS version",
        ));
    }
    let method_count = head[1] as usize;
    let mut methods = vec![0u8; method_count];
    client.read_exact(&mut methods).await?;
    if !methods.contains(&METHOD_USERNAME_PASSWORD) {
        client
            .write_all(&[SOCKS_VERSION, METHOD_NO_ACCEPTABLE])
            .await?;
        metrics::record_auth_failure("socks5_no_supported_method");
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "SOCKS5 username/password auth required",
        ));
    }
    client
        .write_all(&[SOCKS_VERSION, METHOD_USERNAME_PASSWORD])
        .await?;

    let mut auth_head = [0u8; 2];
    client.read_exact(&mut auth_head).await?;
    if auth_head[0] != AUTH_VERSION {
        client.write_all(&[AUTH_VERSION, 0x01]).await?;
        metrics::record_auth_failure("socks5_auth_version");
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid SOCKS5 auth version",
        ));
    }

    let username = read_len_prefixed_string(client, auth_head[1] as usize).await?;
    let mut pass_len = [0u8; 1];
    client.read_exact(&mut pass_len).await?;
    let password = read_len_prefixed_string(client, pass_len[0] as usize).await?;

    match authenticator
        .resolve_proxy_auth(
            &username,
            &password,
            &state.config.session_intent_signing_secret,
        )
        .await
    {
        Ok(Some(resolved)) => {
            client.write_all(&[AUTH_VERSION, 0x00]).await?;
            Ok(AuthenticatedSession {
                username: resolved.username,
                session: resolved.session,
            })
        }
        Ok(None) => {
            client.write_all(&[AUTH_VERSION, 0x01]).await?;
            metrics::record_auth_failure("socks5_invalid_or_expired");
            Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "SOCKS5 credentials invalid or expired",
            ))
        }
        Err(e) => {
            client.write_all(&[AUTH_VERSION, 0x01]).await?;
            metrics::record_auth_failure("socks5_auth_backend_error");
            Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                e.to_string(),
            ))
        }
    }
}

async fn read_connect_request(client: &mut TcpStream) -> io::Result<SocksRequest> {
    let mut head = [0u8; 4];
    client.read_exact(&mut head).await?;
    if head[0] != SOCKS_VERSION {
        send_reply(client, REP_GENERAL_FAILURE).await?;
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid SOCKS request version",
        ));
    }
    if head[1] != CMD_CONNECT {
        send_reply(client, REP_COMMAND_NOT_SUPPORTED).await?;
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "only SOCKS5 CONNECT is supported",
        ));
    }
    if head[2] != 0 {
        send_reply(client, REP_GENERAL_FAILURE).await?;
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid SOCKS reserved byte",
        ));
    }

    let host = match head[3] {
        0x01 => {
            let mut ip = [0u8; 4];
            client.read_exact(&mut ip).await?;
            std::net::Ipv4Addr::from(ip).to_string()
        }
        0x03 => {
            let mut len = [0u8; 1];
            client.read_exact(&mut len).await?;
            read_len_prefixed_string(client, len[0] as usize).await?
        }
        0x04 => {
            let mut ip = [0u8; 16];
            client.read_exact(&mut ip).await?;
            std::net::Ipv6Addr::from(ip).to_string()
        }
        _ => {
            send_reply(client, REP_ADDRESS_TYPE_NOT_SUPPORTED).await?;
            return Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "SOCKS5 address type unsupported",
            ));
        }
    };

    let mut port_bytes = [0u8; 2];
    client.read_exact(&mut port_bytes).await?;
    let port = u16::from_be_bytes(port_bytes);
    let addr = if host.contains(':') && host.parse::<std::net::Ipv6Addr>().is_ok() {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    };

    Ok(SocksRequest { addr, host, port })
}

async fn validate_session_policy(
    auth: &AuthenticatedSession,
    request: &SocksRequest,
    state: &AppState,
) -> io::Result<()> {
    if policy::host_matches_any_domain_rule(&request.host, &auth.session.blocked_domains) {
        metrics::record_policy_block("session_blocked_domain");
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "Destination blocked by session policy",
        ));
    }
    if !auth.session.allowed_domains.is_empty()
        && !policy::host_matches_any_domain_rule(&request.host, &auth.session.allowed_domains)
    {
        metrics::record_policy_block("session_domain_not_whitelisted");
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "Destination not in session allowlist",
        ));
    }
    if !auth.session.session_within_time_limit() {
        metrics::record_auth_failure("session_time_limit");
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "Proxy session expired",
        ));
    }
    if !state.check_rate_limit(&auth.username) {
        metrics::record_rate_limit_hit("socks5_connection_rate");
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "Rate limit exceeded",
        ));
    }
    if state.anomaly.record_request(&auth.session.session_id) {
        metrics::record_policy_block("anomaly_high_rpm");
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "Session anomaly limit exceeded",
        ));
    }
    Ok(())
}

async fn validate_node_policy(
    authenticator: &SessionAuthenticator,
    node_id: &str,
    request: &SocksRequest,
) -> io::Result<()> {
    let Some(ncfg) = authenticator.get_node_config(node_id).await else {
        return Ok(());
    };
    let dest_port = request.port as i64;
    if ncfg.blocked_ports.contains(&dest_port) {
        metrics::record_policy_block("node_blocked_port");
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "Destination port blocked by provider policy",
        ));
    }
    if !ncfg.allowed_ports.is_empty() && !ncfg.allowed_ports.contains(&dest_port) {
        metrics::record_policy_block("node_port_not_whitelisted");
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "Destination port not allowed by provider policy",
        ));
    }
    if policy::host_matches_any_domain_rule(&request.host, &ncfg.blocked_domains) {
        metrics::record_policy_block("node_blocked_domain");
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "Destination domain blocked by provider policy",
        ));
    }
    if !ncfg.allowed_domains.is_empty()
        && !policy::host_matches_any_domain_rule(&request.host, &ncfg.allowed_domains)
    {
        metrics::record_policy_block("node_domain_not_whitelisted");
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "Destination domain not allowed by provider policy",
        ));
    }
    Ok(())
}

async fn bridge_local_provider(
    mut client: TcpStream,
    addr: String,
    mut control: yamux::Control,
    node_id: String,
    state: Arc<AppState>,
) -> io::Result<(u64, u64)> {
    let connect_timeout = std::time::Duration::from_secs(state.config.proxy_connect_timeout_secs);
    let mut stream = tokio::time::timeout(connect_timeout, control.open_stream())
        .await
        .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "yamux stream open timed out"))?
        .map_err(|e| io::Error::new(io::ErrorKind::ConnectionRefused, e.to_string()))?;

    let command = format!("CONNECT {addr}\n");
    futures_util::AsyncWriteExt::write_all(&mut stream, command.as_bytes()).await?;

    let mut response_buf = [0u8; 64];
    let n = tokio::time::timeout(
        connect_timeout,
        futures_util::AsyncReadExt::read(&mut stream, &mut response_buf),
    )
    .await
    .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "provider CONNECT timed out"))??;

    let response = String::from_utf8_lossy(&response_buf[..n]);
    if !response.starts_with("OK") {
        send_reply(&mut client, REP_HOST_UNREACHABLE).await?;
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            format!("Provider refused: {}", response.trim()),
        ));
    }

    send_reply(&mut client, REP_SUCCEEDED).await?;
    let mut stream = stream.compat();
    let (bytes_up, bytes_down) = tokio::io::copy_bidirectional(&mut client, &mut stream)
        .await
        .unwrap_or((0, 0));
    debug!(%node_id, %addr, bytes_up, bytes_down, "SOCKS5 local provider bridge ended");
    Ok((bytes_up, bytes_down))
}

async fn record_successful_usage(
    state: Arc<AppState>,
    authenticator: &SessionAuthenticator,
    auth: &AuthenticatedSession,
    node_id: &str,
    dest_host: &str,
    bytes_up: u64,
    bytes_down: u64,
) {
    let total_bytes = bytes_up.saturating_add(bytes_down);
    state
        .usage_tracker
        .record(&auth.username, bytes_up, bytes_down)
        .await;
    metrics::record_provider_bandwidth(node_id, bytes_up, bytes_down);
    metrics::record_bandwidth(bytes_up, bytes_down);
    if let Err(e) = authenticator
        .report_usage(&auth.username, total_bytes as i64)
        .await
    {
        error!(error = %e, username = %auth.username, "Failed to report SOCKS5 usage");
    }
    crate::finalize_session_intent_ledger(
        state.clone(),
        &auth.session,
        Some(node_id),
        Some(dest_host),
        bytes_up,
        bytes_down,
    )
    .await;
}

async fn bridge_to_malicious_sink(mut client: TcpStream) -> io::Result<()> {
    let (mut sink_tx, sink_rx) = tokio::io::duplex(4096);
    tokio::spawn(async move {
        let _ = handle_malicious_connection(sink_rx).await;
    });
    let _ = tokio::io::copy_bidirectional(&mut client, &mut sink_tx).await;
    Ok(())
}

async fn send_reply(client: &mut TcpStream, reply: u8) -> io::Result<()> {
    client
        .write_all(&[SOCKS_VERSION, reply, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
        .await
}

async fn read_len_prefixed_string(client: &mut TcpStream, len: usize) -> io::Result<String> {
    let mut buf = vec![0u8; len];
    client.read_exact(&mut buf).await?;
    String::from_utf8(buf).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e.to_string()))
}

fn current_utc_hour() -> u8 {
    (std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        / 3600
        % 24) as u8
}

fn env_bool(key: &str, default: bool) -> bool {
    std::env::var(key)
        .ok()
        .and_then(|value| match value.trim().to_ascii_lowercase().as_str() {
            "1" | "true" | "yes" | "on" => Some(true),
            "0" | "false" | "no" | "off" => Some(false),
            _ => None,
        })
        .unwrap_or(default)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn listen_addr_uses_default_host() {
        std::env::remove_var("SOCKS5_HOST");
        std::env::remove_var("SOCKS5_PORT");
        assert_eq!(
            listen_addr("127.0.0.1").unwrap(),
            "127.0.0.1:1080".parse::<SocketAddr>().unwrap()
        );
    }
}

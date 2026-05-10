use crate::state::{AppState, NodeInfo};
use crate::tls::{create_tls_acceptor, is_tls_enabled, TlsConfig};
use crate::auth::provider_lease::{lease_is_fresh, provider_leases_required, ProviderLeaseValidator};
use anyhow::Context;
use futures_util::io::AsyncRead as FuturesAsyncRead;
use futures_util::{AsyncReadExt, AsyncWriteExt, StreamExt};
use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use std::io::{Error as IoError, ErrorKind as IoErrorKind};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::io::{AsyncRead as TokioAsyncRead, AsyncWrite as TokioAsyncWrite};
use tokio::net::TcpListener;
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};
use tracing::{debug, error, info, trace, warn};
use yamux::{Config, Connection, Mode, WindowUpdateMode};

#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    #[serde(rename = "sub")]
    user_id: String,
    role: String,
    exp: usize,
}

/// P1-A6: Provider capability declaration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderCapabilities {
    pub max_connections: u32,
    pub max_bandwidth_mbps: u32,
    pub available_ports: Vec<u16>,
    pub connection_type: String, // "fiber", "cable", "dsl", "mobile", "satellite"
    pub uplink_speed_kbps: u32,
    pub downlink_speed_kbps: u32,
    pub cpu_cores: u32,
    pub memory_mb: u32,
    pub os: String,
    pub client_version: String,
    pub features: Vec<String>, // Optional features like "ipv6", "udp_relay", etc.
    #[serde(default)]
    pub provider_lease: String,
}

impl Default for ProviderCapabilities {
    fn default() -> Self {
        Self {
            max_connections: 100,
            max_bandwidth_mbps: 100,
            available_ports: vec![80, 443],
            connection_type: "unknown".to_string(),
            uplink_speed_kbps: 10_000,   // 10 Mbps default
            downlink_speed_kbps: 50_000, // 50 Mbps default
            cpu_cores: 2,
            memory_mb: 4096,
            os: "unknown".to_string(),
            client_version: "1.0.0".to_string(),
            features: vec![],
            provider_lease: String::new(),
        }
    }
}

/// P1-A6: Assigned limits based on capabilities and quality
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssignedLimits {
    pub max_connections: u32,
    pub bandwidth_cap_mbps: u32,
    pub allowed_ports: Vec<u16>,
    pub qos_tier: String, // "premium", "standard", "basic", "limited"
    pub priority: u32,    // 0-100 routing priority
}

impl Default for AssignedLimits {
    fn default() -> Self {
        Self {
            max_connections: 100,
            bandwidth_cap_mbps: 100,
            allowed_ports: vec![80, 443],
            qos_tier: "basic".to_string(),
            priority: 50,
        }
    }
}

const MAX_HEARTBEAT_FRAME_BYTES: usize = 16 * 1024;

async fn read_line_frame<R: FuturesAsyncRead + Unpin>(
    reader: &mut R,
    max_bytes: usize,
) -> std::io::Result<Option<String>> {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 1024];

    loop {
        let bytes_read = reader.read(&mut chunk).await?;
        if bytes_read == 0 {
            if buffer.is_empty() {
                return Ok(None);
            }
            break;
        }

        buffer.extend_from_slice(&chunk[..bytes_read]);
        if buffer.len() > max_bytes {
            return Err(IoError::new(
                IoErrorKind::InvalidData,
                format!("frame exceeds {} bytes", max_bytes),
            ));
        }

        if let Some(newline_pos) = buffer.iter().position(|byte| *byte == b'\n') {
            buffer.truncate(newline_pos);
            break;
        }
    }

    let message = String::from_utf8_lossy(&buffer)
        .trim_end_matches('\r')
        .to_string();
    Ok(Some(message))
}

pub async fn run_tunnel_server(
    port: u16,
    state: Arc<AppState>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = TcpListener::bind(addr).await?;

    let tls_acceptor = if is_tls_enabled() {
        match TlsConfig::from_env() {
            Some(config) => match create_tls_acceptor(&config) {
                Ok(acceptor) => {
                    info!("🔐 Tunnel Server listening on {} (TLS enabled)", addr);
                    Some(acceptor)
                }
                Err(e) => {
                    error!("⚠️ Failed to create TLS acceptor: {}", e);
                    None
                }
            },
            None => None,
        }
    } else {
        info!("Tunnel Server listening on {} (plaintext)", addr);
        None
    };

    loop {
        let (stream, peer_addr) = listener.accept().await?;
        let state = state.clone();
        let tls_acceptor = tls_acceptor.clone();

        tokio::spawn(async move {
            if let Some(acceptor) = tls_acceptor {
                match acceptor.accept(stream).await {
                    Ok(tls_stream) => {
                        handle_provider_connection(tls_stream, peer_addr, state).await;
                    }
                    Err(e) => {
                        error!("❌ TLS handshake failed with {}: {}", peer_addr, e);
                    }
                }
            } else {
                handle_provider_connection(stream, peer_addr, state).await;
            }
        });
    }
}

async fn handle_provider_connection<S>(stream: S, peer_addr: SocketAddr, state: Arc<AppState>)
where
    S: TokioAsyncRead + TokioAsyncWrite + Unpin + Send + 'static,
{
    let mut cfg = Config::default();
    cfg.set_window_update_mode(WindowUpdateMode::OnRead);

    let stream = stream.compat();
    let conn = Connection::new(stream, cfg, Mode::Server);
    let ctrl = conn.control();

    let (tx, mut rx) = tokio::sync::mpsc::channel::<yamux::Stream>(256);
    let peer_addr_clone = peer_addr.clone();

    // Spawn the background driver - It ONLY drives the connection and dispatches new streams
    tokio::spawn(async move {
        let mut incoming = Box::pin(yamux::into_stream(conn));
        loop {
            tokio::select! {
                result = incoming.next() => {
                    match result {
                        Some(Ok(s)) => {
                            if tx.send(s).await.is_err() { break; }
                        }
                        _ => break,
                    }
                }
                _ = tokio::time::sleep(std::time::Duration::from_millis(10)) => {
                    // Protocol driving pulse
                }
            }
        }
        debug!("Yamux driver task finished for {}", peer_addr_clone);
    });

    // 1. AUTH Handshake
    let mut auth_stream =
        match tokio::time::timeout(std::time::Duration::from_secs(15), rx.recv()).await {
            Ok(Some(s)) => s,
            _ => {
                error!("Handshake: Auth stream timeout from {}", peer_addr);
                return;
            }
        };

    let mut buf = [0u8; 4096];
    let user_id = match auth_stream.read(&mut buf).await {
        Ok(n) if n > 0 => {
            let msg = String::from_utf8_lossy(&buf[..n]);
            if msg.starts_with("AUTH ") {
                let token = msg[5..].trim();
                let validation = Validation::new(Algorithm::HS256);
                match decode::<Claims>(
                    token,
                    &DecodingKey::from_secret(state.config.jwt_secret.as_bytes()),
                    &validation,
                ) {
                    Ok(token_data) => {
                        let _ = auth_stream.write_all(b"OK\n").await;
                        let _ = auth_stream.flush().await;
                        token_data.claims.user_id
                    }
                    Err(e) => {
                        error!("Handshake: AUTH failed for {}: {}", peer_addr, e);
                        return;
                    }
                }
            } else {
                error!("Handshake: Expected AUTH from {}", peer_addr);
                return;
            }
        }
        _ => {
            error!("Handshake: Auth read error from {}", peer_addr);
            return;
        }
    };

    // 2. CAPABILITY Handshake
    let mut cap_stream =
        match tokio::time::timeout(std::time::Duration::from_secs(10), rx.recv()).await {
            Ok(Some(s)) => s,
            _ => {
                error!("Handshake: Capability stream timeout for {}", user_id);
                return;
            }
        };

    let caps = match cap_stream.read(&mut buf).await {
        Ok(n) if n > 0 => {
            let msg = String::from_utf8_lossy(&buf[..n]);
            if msg.starts_with("CAPABILITY ") {
                match serde_json::from_str::<ProviderCapabilities>(&msg[11..]) {
                    Ok(caps) => {
                        let assigned = calculate_assigned_limits(&caps);
                        let ack = format!(
                            "ACK {}\n",
                            serde_json::to_string(&assigned).unwrap_or_default()
                        );
                        let _ = cap_stream.write_all(ack.as_bytes()).await;
                        let _ = cap_stream.flush().await;
                        let _ = cap_stream.close().await;
                        caps
                    }
                    Err(e) => {
                        error!("Handshake: CAPABILITY parse error for {}: {}", user_id, e);
                        return;
                    }
                }
            } else {
                error!("Handshake: Expected CAPABILITY from {}", user_id);
                return;
            }
        }
        _ => {
            error!("Handshake: Capability read error for {}", user_id);
            return;
        }
    };

    let node_id = format!("node_{}", user_id);
    let ip_address = peer_addr.ip().to_string();
    let provider_leases_required = provider_leases_required();
    let lease_claims = if caps.provider_lease.trim().is_empty() {
        None
    } else {
        match ProviderLeaseValidator::new(state.config.gateway_shared_secret.clone())
            .validate(&caps.provider_lease, &user_id, &caps)
        {
            Ok(claims) => Some(claims),
            Err(err) => {
                if provider_leases_required {
                    error!("Handshake: provider lease invalid for {}: {}", user_id, err);
                    return;
                }
                warn!("Handshake: provider lease invalid for {} (compatibility mode): {}", user_id, err);
                None
            }
        }
    };

    if caps.provider_lease.trim().is_empty() {
        if provider_leases_required {
            error!("Handshake: provider lease required but missing for {}", user_id);
            return;
        }
        warn!("Handshake: provider lease missing for {} — continuing in compatibility mode", user_id);
    } else if lease_claims.is_some() {
        info!("Handshake: provider lease accepted for {}", user_id);
    }

    let mut persisted_caps = caps.clone();
    persisted_caps.provider_lease.clear();

    let assigned_limits = calculate_assigned_limits(&persisted_caps);

    let mut node_info = match state.registry_store.load_node(&user_id).await {
        Ok(Some(mut info)) => {
            info.ip_address = ip_address.clone();
            info.node_id = node_id.clone();
            info.connected_at = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            info.is_healthy = true;
            info.capabilities = persisted_caps.clone();
            info.assigned_limits = assigned_limits.clone();
            info.max_connections = assigned_limits.max_connections;
            info.qos_tier = assigned_limits.qos_tier.clone();
            info.lease_expires_at = lease_claims.as_ref().map(|claims| claims.exp as u64).unwrap_or(0);
            info
        }
        _ => NodeInfo::with_capabilities(
            node_id.clone(),
            ip_address.clone(),
            Some(user_id.clone()),
            persisted_caps.clone(),
            assigned_limits.clone(),
        ),
    };

    if let Some(ref reader) = state.geoip {
        if let Ok(addr) = ip_address.parse() {
            if let Ok(country) = reader.lookup::<maxminddb::geoip2::Country>(addr) {
                if let Some(iso_code) = country.country.and_then(|c| c.iso_code) {
                    node_info.country_code = iso_code.to_string();
                }
            }
        }
    }

    if node_info.lease_expires_at == 0 {
        node_info.lease_expires_at = lease_claims.as_ref().map(|claims| claims.exp as u64).unwrap_or(0);
    }

    state
        .registry
        .insert(node_id.clone(), ctrl, node_info.clone());
    state.heartbeat_monitor.register_provider(&node_id).await;
    if let Err(err) = state.registry_store.save_node(&user_id, &node_info).await {
        warn!(node_id = %node_id, error = %err, "Failed to persist node info to registry store");
    }

    // Async registration with Control API
    let control_api = state.control_api.clone();
    let reg_state = state.clone();
    let reg_node_id = node_id.clone();
    let reg_user_id = user_id.clone();
    let reg_ip = ip_address.clone();
    let reg_country = node_info.country_code.clone();
    let reg_connection_type = caps.connection_type.clone();
    let reg_version = caps.client_version.clone();

    tokio::spawn(async move {
        let req = crate::control_api::RegisterNodeRequest {
            provider_user_id: reg_user_id.clone(),
            node_id: reg_node_id.clone(),
            ip_address: reg_ip.clone(),
            port: 0,
            region: "Unknown".into(),
            country_code: reg_country,
            city: "Unknown".into(),
            isp: reg_ip,
            connection_type: reg_connection_type,
            version: reg_version,
        };
        if let Ok(resp) = control_api.register_node(&req).await {
            info!("✅ Node registered with Control API: {}", reg_node_id);
            reg_state.registry.update_node_info(&reg_node_id, |info| {
                info.quality_score = resp.quality_score;
                info.current_tier = resp.current_tier;
                info.base_price_per_gb = resp.base_price_per_gb;
            });
            if let Some(info) = reg_state.registry.get_node_info(&reg_node_id) {
                if let Err(err) = reg_state.registry_store.save_node(&reg_user_id, &info).await {
                    warn!(node_id = %reg_node_id, error = %err, "Failed to persist updated node info");
                }
            }
        }
    });

    info!("✅ Provider connected: {} from {}", node_id, peer_addr);

    // Main stream acceptance loop (Heartbeats + Data)
    while let Some(mut stream) = rx.recv().await {
        let state = state.clone();
        let node_id = node_id.clone();
        tokio::spawn(async move {
            match read_line_frame(&mut stream, MAX_HEARTBEAT_FRAME_BYTES).await {
                Ok(Some(msg)) => {
                    if msg.starts_with("HEARTBEAT:") {
                        debug!("Incoming raw heartbeat: {:?}", msg);
                        let parts: Vec<&str> = msg.splitn(4, ':').collect();
                        if parts.len() >= 4 {
                            let timestamp: u64 = parts[2].parse().unwrap_or_else(|e| {
                                error!("Failed to parse heartbeat timestamp '{}': {}", parts[2], e);
                                0
                            });
                            let json_data = parts[3].trim();

                            match serde_json::from_str::<crate::heartbeat::HeartbeatMessage>(
                                json_data,
                            ) {
                                Ok(heartbeat_msg) => {
                                    let now = std::time::SystemTime::now()
                                        .duration_since(std::time::UNIX_EPOCH)
                                        .map(|d| d.as_secs())
                                        .unwrap_or(0);

                                    let latency = if now >= timestamp {
                                        (now - timestamp) as u32 * 1000
                                    } else {
                                        0
                                    };
                                    if let Err(e) = state
                                        .heartbeat_monitor
                                        .record_heartbeat_details(&heartbeat_msg, latency)
                                        .await
                                    {
                                        error!(
                                            "Failed to record heartbeat details for {}: {}",
                                            heartbeat_msg.node_id, e
                                        );
                                    }
                                    let bandwidth_rate_kbps = heartbeat_msg
                                        .bandwidth_usage
                                        .rate_up_kbps
                                        .saturating_add(heartbeat_msg.bandwidth_usage.rate_down_kbps);
                                    let total_bytes_served = heartbeat_msg
                                        .bandwidth_usage
                                        .bytes_up
                                        .saturating_add(heartbeat_msg.bandwidth_usage.bytes_down);
                                    let mut lease_valid = true;
                                    let mut lease_expiry = state
                                        .registry
                                        .get_node_info(&heartbeat_msg.node_id)
                                        .map(|info| info.lease_expires_at)
                                        .unwrap_or(0);

                                    if !heartbeat_msg.provider_lease.trim().is_empty() {
                                        if let Some(info) = state.registry.get_node_info(&heartbeat_msg.node_id) {
                                            let caps = info.capabilities.clone();
                                            let expected_user_id = info.user_id.unwrap_or_default();
                                            match ProviderLeaseValidator::new(state.config.gateway_shared_secret.clone())
                                                .validate(&heartbeat_msg.provider_lease, &expected_user_id, &caps)
                                            {
                                                Ok(claims) => {
                                                    lease_expiry = claims.exp as u64;
                                                    state.registry.update_node_info(&heartbeat_msg.node_id, |node_info| {
                                                        node_info.lease_expires_at = lease_expiry;
                                                    });
                                                }
                                                Err(err) => {
                                                    lease_valid = false;
                                                    warn!("Heartbeat: invalid provider lease for {}: {}", heartbeat_msg.node_id, err);
                                                }
                                            }
                                        }
                                    } else if provider_leases_required && !lease_is_fresh(lease_expiry) {
                                        lease_valid = false;
                                        warn!("Heartbeat: provider lease expired for {}", heartbeat_msg.node_id);
                                    }

                                    state.registry.update_live_metrics(
                                        &heartbeat_msg.node_id,
                                        heartbeat_msg.active_connections,
                                        latency,
                                        bandwidth_rate_kbps,
                                        total_bytes_served,
                                    );
                                    if lease_valid {
                                        state.registry.mark_healthy(&heartbeat_msg.node_id);
                                    } else {
                                        state.registry.mark_unhealthy(&heartbeat_msg.node_id);
                                    }
                                    if let Some(info) = state.registry.get_node_info(&heartbeat_msg.node_id) {
                                        if let Some(user_id) = info.user_id.clone() {
                                            if let Err(err) = state.registry_store.save_node(&user_id, &info).await {
                                                warn!(node_id = %heartbeat_msg.node_id, error = %err, "Failed to persist heartbeat-updated node info");
                                            }
                                        }
                                    }
                                    let response = format!("PONG {{\"latency_ms\":{}}}\n", latency);
                                    let _ = stream.write_all(response.as_bytes()).await;
                                }
                                Err(e) => {
                                    error!(
                                        "Failed to parse heartbeat JSON from {}: {} (data: '{}')",
                                        parts[1], e, json_data
                                    );
                                }
                            }
                        } else {
                            warn!(
                                "Received legacy or malformed heartbeat: '{}' (parts={})",
                                msg,
                                parts.len()
                            );
                            // Backwards compatibility for simple HEARTBEAT:node_id
                            let _ = state
                                .heartbeat_monitor
                                .record_heartbeat_details(
                                    &crate::heartbeat::HeartbeatMessage {
                                        node_id: node_id.clone(),
                                        timestamp: 0,
                                        active_connections: 0,
                                        bandwidth_usage: crate::heartbeat::BandwidthUsage {
                                            bytes_up: 0,
                                            bytes_down: 0,
                                            rate_up_kbps: 0,
                                            rate_down_kbps: 0,
                                        },
                                        system_stats: crate::heartbeat::SystemStats {
                                            cpu_percent: 0.0,
                                            memory_percent: 0.0,
                                            uptime_seconds: 0,
                                            goroutines: 0,
                                        },
                                        provider_lease: String::new(),
                                    },
                                    0,
                                )
                                .await;
                            let _ = stream.write_all(b"PONG {\"latency_ms\":0}\n").await;
                        }
                    }
                }
                Ok(None) => {}
                Err(err) => {
                    warn!(node_id = %node_id, error = %err, "Failed to read heartbeat frame");
                }
            }
        });
    }

    warn!("Provider disconnected: {}", node_id);
    let _ = state.heartbeat_monitor.unregister_provider(&node_id).await;
    state.registry.remove(&node_id);
}

fn calculate_assigned_limits(caps: &ProviderCapabilities) -> AssignedLimits {
    let max_conns = if caps.cpu_cores >= 4 { 200 } else { 50 };
    AssignedLimits {
        max_connections: max_conns,
        bandwidth_cap_mbps: caps.max_bandwidth_mbps,
        allowed_ports: caps.available_ports.clone(),
        qos_tier: "standard".into(),
        priority: 50,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::duplex;

    #[tokio::test]
    async fn reads_large_heartbeat_frame_across_multiple_reads() {
        let (writer, reader) = duplex(8 * 1024);
        let mut writer = writer.compat_write();
        let mut reader = reader.compat();
        let heartbeat = crate::heartbeat::HeartbeatMessage {
            node_id: "node_provider-large-heartbeat".to_string(),
            timestamp: 1_777_675_904,
            active_connections: 1,
            bandwidth_usage: crate::heartbeat::BandwidthUsage {
                bytes_up: 0,
                bytes_down: 0,
                rate_up_kbps: 0,
                rate_down_kbps: 0,
            },
            system_stats: crate::heartbeat::SystemStats {
                cpu_percent: 12.5,
                memory_percent: 34.5,
                uptime_seconds: 60,
                goroutines: 0,
            },
            provider_lease: "lease".repeat(400),
        };
        let heartbeat_json = serde_json::to_string(&heartbeat).unwrap();
        let frame = format!(
            "HEARTBEAT:{}:{}:{}\n",
            heartbeat.node_id, heartbeat.timestamp, heartbeat_json
        );
        let split_at = 700;

        tokio::spawn(async move {
            writer
                .write_all(frame[..split_at].as_bytes())
                .await
                .unwrap();
            tokio::task::yield_now().await;
            writer
                .write_all(frame[split_at..].as_bytes())
                .await
                .unwrap();
        });

        let frame = read_line_frame(&mut reader, MAX_HEARTBEAT_FRAME_BYTES)
            .await
            .unwrap()
            .unwrap();
        let parts: Vec<&str> = frame.splitn(4, ':').collect();

        assert_eq!(parts.len(), 4);
        let parsed: crate::heartbeat::HeartbeatMessage = serde_json::from_str(parts[3]).unwrap();
        assert_eq!(parsed.node_id, "node_provider-large-heartbeat");
        assert_eq!(parsed.provider_lease.len(), "lease".len() * 400);
    }
}

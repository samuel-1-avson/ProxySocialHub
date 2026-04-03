use crate::state::{AppState, NodeInfo};
use crate::tls::{create_tls_acceptor, is_tls_enabled, TlsConfig};
use anyhow::Context;
use futures_util::{AsyncReadExt, AsyncWriteExt, StreamExt};
use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::TcpListener;
use tokio_util::compat::TokioAsyncReadCompatExt;
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
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
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

    let mut node_info = match state.registry_store.load_node(&user_id).await {
        Ok(Some(mut info)) => {
            info.ip_address = ip_address.clone();
            info.node_id = node_id.clone();
            info.connected_at = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            info.is_healthy = true;
            info
        }
        _ => NodeInfo::new(node_id.clone(), ip_address.clone(), Some(user_id.clone())),
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

    state
        .registry
        .insert(node_id.clone(), ctrl, node_info.clone());
    state.heartbeat_monitor.register_provider(&node_id).await;

    // Async registration with Control API
    let control_api = state.control_api.clone();
    let reg_state = state.clone();
    let reg_node_id = node_id.clone();
    let reg_user_id = user_id.clone();
    let reg_ip = ip_address.clone();
    let reg_country = node_info.country_code.clone();

    tokio::spawn(async move {
        let req = crate::control_api::RegisterNodeRequest {
            provider_user_id: reg_user_id,
            node_id: reg_node_id.clone(),
            ip_address: reg_ip.clone(),
            port: 0,
            region: "Unknown".into(),
            country_code: reg_country,
            city: "Unknown".into(),
            isp: reg_ip,
            connection_type: "residential".into(),
            version: env!("CARGO_PKG_VERSION").into(),
        };
        if let Ok(resp) = control_api.register_node(&req).await {
            info!("✅ Node registered with Control API: {}", reg_node_id);
            reg_state.registry.update_node_info(&reg_node_id, |info| {
                info.quality_score = resp.quality_score;
                info.current_tier = resp.current_tier;
                info.base_price_per_gb = resp.base_price_per_gb;
            });
        }
    });

    info!("✅ Provider connected: {} from {}", node_id, peer_addr);

    // Main stream acceptance loop (Heartbeats + Data)
    while let Some(mut stream) = rx.recv().await {
        let state = state.clone();
        let node_id = node_id.clone();
        tokio::spawn(async move {
            let mut buf = [0u8; 1024];
            match stream.read(&mut buf).await {
                Ok(n) if n > 0 => {
                    let msg = String::from_utf8_lossy(&buf[..n]);
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
                                    },
                                    0,
                                )
                                .await;
                            let _ = stream.write_all(b"PONG {\"latency_ms\":0}\n").await;
                        }
                    }
                }
                _ => {}
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

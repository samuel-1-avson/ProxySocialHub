use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio_util::compat::TokioAsyncReadCompatExt;
use yamux::{Config, Connection, Mode, WindowUpdateMode};
use crate::state::{AppState, NodeInfo};
use crate::tls::{TlsConfig, create_tls_acceptor, is_tls_enabled};
use futures_util::{StreamExt, AsyncReadExt, AsyncWriteExt};
use tracing::{info, warn, error, trace, debug};
use jsonwebtoken::{decode, DecodingKey, Validation, Algorithm};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
struct Claims {
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
            uplink_speed_kbps: 10_000,  // 10 Mbps default
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

pub async fn run_tunnel_server(port: u16, state: Arc<AppState>) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = TcpListener::bind(addr).await?;
    
    // Check if TLS is enabled
    let tls_acceptor = if is_tls_enabled() {
        match TlsConfig::from_env() {
            Some(config) => {
                match create_tls_acceptor(&config) {
                    Ok(acceptor) => {
                        info!("🔐 Tunnel Server listening on {} (TLS enabled)", addr);
                        if config.require_client_cert {
                            info!("   mTLS: Client certificate required");
                        }
                        Some(acceptor)
                    }
                    Err(e) => {
                        error!("⚠️  Failed to create TLS acceptor: {}", e);
                        warn!("Tunnel Server listening on {} (TLS disabled - fallback)", addr);
                        None
                    }
                }
            }
            None => {
                info!("Tunnel Server listening on {} (TLS not configured)", addr);
                None
            }
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
            // Handle TLS or plaintext connection
            if let Some(acceptor) = tls_acceptor {
                match acceptor.accept(stream).await {
                    Ok(tls_stream) => {
                        info!("🔐 TLS handshake successful with {}", peer_addr);
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
    
    // Get the incoming streams + control
    let ctrl = conn.control();
    // Use Box::pin for yamux stream since into_stream returns !Unpin
    let mut incoming = Box::pin(yamux::into_stream(conn));

    // AUTHENTICATION HANDSHAKE
    // Expect the FIRST stream to be an Auth channel
    let mut authenticated_user_id = None;
    let mut auth_stream_handle: Option<yamux::Stream> = None;

    // Timeout for auth (10 seconds)
    match tokio::time::timeout(std::time::Duration::from_secs(10), incoming.next()).await {
        Ok(Some(Ok(mut stream))) => {
            // Read AUTH <token>
            let mut buf = [0u8; 4096]; // 4kb should be enough for JWT
            match stream.read(&mut buf).await {
                Ok(n) if n > 0 => {
                    let msg = String::from_utf8_lossy(&buf[..n]);
                    if msg.starts_with("AUTH ") {
                        let token = msg[5..].trim();
                        
                        // Validate Token
                        let validation = Validation::new(Algorithm::HS256);
                        
                        // Note: If tokens are from Go (StandardClaims), make sure fields match
                        match decode::<Claims>(token, &DecodingKey::from_secret(state.config.jwt_secret.as_bytes()), &validation) {
                            Ok(token_data) => {
                                info!("🔑 Authenticated user: {}", token_data.claims.user_id);
                                authenticated_user_id = Some(token_data.claims.user_id);
                                if let Err(e) = stream.write_all(b"OK\n").await {
                                    error!("Failed to send OK: {}", e);
                                    return;
                                }
                                auth_stream_handle = Some(stream); // Keep stream open or close? Usually keep open or close gracefully.
                            }
                            Err(e) => {
                                warn!("Auth failed: {}", e);
                                let _ = stream.write_all(format!("ERROR {}\n", e).as_bytes()).await;
                                return;
                            }
                        }
                    } else {
                        warn!("Invalid handshake: expected AUTH");
                    }
                }
                Ok(_) => warn!("Auth stream empty"),
                Err(e) => error!("Auth read error: {}", e),
            }
        }
        Ok(Some(Err(e))) => {
             error!("Connection error waiting for auth: {}", e);
             return;
        }
        Ok(None) => return, // Closed
        Err(_) => {
            error!("Auth timeout");
            return;
        }
    }

    if authenticated_user_id.is_none() {
        warn!("Authentication required. Closing connection.");
        return;
    }

    let user_id = authenticated_user_id.unwrap();
    
    // P1-A6: CAPABILITY HANDSHAKE
    // Expect CAPABILITY declaration from provider after successful AUTH
    let capabilities = match tokio::time::timeout(
        std::time::Duration::from_secs(5),
        incoming.next()
    ).await {
        Ok(Some(Ok(mut stream))) => {
            let mut buf = [0u8; 8192]; // 8KB for capability JSON
            match stream.read(&mut buf).await {
                Ok(n) if n > 0 => {
                    let msg = String::from_utf8_lossy(&buf[..n]);
                    if msg.starts_with("CAPABILITY ") {
                        let json_str = &msg[11..];
                        match serde_json::from_str::<ProviderCapabilities>(json_str) {
                            Ok(caps) => {
                                info!("📊 Provider {} capabilities: {:?}", user_id, caps);
                                // Send ACK with assigned limits
                                let assigned = calculate_assigned_limits(&caps);
                                let ack = format!("ACK {}\n", serde_json::to_string(&assigned).unwrap_or_default());
                                let _ = stream.write_all(ack.as_bytes()).await;
                                caps
                            }
                            Err(e) => {
                                warn!("Invalid capability JSON from {}: {}", user_id, e);
                                // Send default ACK
                                let assigned = calculate_assigned_limits(&ProviderCapabilities::default());
                                let ack = format!("ACK {}\n", serde_json::to_string(&assigned).unwrap_or_default());
                                let _ = stream.write_all(ack.as_bytes()).await;
                                ProviderCapabilities::default()
                            }
                        }
                    } else {
                        warn!("Expected CAPABILITY, got: {}", msg);
                        ProviderCapabilities::default()
                    }
                }
                _ => {
                    warn!("No capability declaration from {}, using defaults", user_id);
                    ProviderCapabilities::default()
                }
            }
        }
        _ => {
            info!("Capability handshake timeout for {}, using defaults", user_id);
            ProviderCapabilities::default()
        }
    };
    
    // START: PERSISTENCE CHANGE
    // Generate a stable Node ID based on User ID (allows reputation to persist)
    let node_id = format!("node_{}", user_id);
    
    // Create node info with peer address
    let ip_address = peer_addr.ip().to_string();
    
    // Load existing metadata from Redis
    let mut node_info = match state.registry_store.load_node(&user_id).await {
        Ok(Some(mut info)) => {
            info!("README: Loaded persistent node info for {}", node_id);
            // Update IP and other transient fields
            info.ip_address = ip_address.clone();
            info.node_id = node_id.clone();
            info.connected_at = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_else(|_| std::time::Duration::from_secs(0))
                .as_secs();
            info.is_healthy = true; // Reset health on new connection
            info
        },
        Ok(None) => {
            info!("README: New node detected for user {}", user_id);
            NodeInfo::new(node_id.clone(), ip_address.clone(), Some(user_id.clone()))
        },
        Err(e) => {
            error!("Failed to load node info from Redis: {}", e);
            // Fallback to new node info
            NodeInfo::new(node_id.clone(), ip_address.clone(), Some(user_id.clone()))
        }
    };
    
    // Detect location using professional GeoIP if available
    if let Some(ref reader) = state.geoip {
        if let Ok(addr) = ip_address.parse() {
            if let Ok(country) = reader.lookup::<maxminddb::geoip2::Country>(addr) {
                if let Some(iso_code) = country.country.and_then(|c| c.iso_code) {
                    node_info.country_code = iso_code.to_string();
                }
            }
            if let Ok(city) = reader.lookup::<maxminddb::geoip2::City>(addr) {
                if let Some(city_name) = city.city.and_then(|c| c.names).and_then(|n| n.get("en").map(|s| s.to_string())) {
                    node_info.region = city_name;
                }
            }
        }
    } else {
        // GeoIP database not loaded — log once and fall back to heuristic detection.
        // Mount a MaxMind GeoLite2-Country.mmdb via GEOIP_DB_PATH to get accurate geo data.
        warn!("GeoIP database not loaded — using heuristic country detection for {}", ip_address);
        node_info.country_code = detect_country_from_ip(&ip_address);
        node_info.region = detect_region_from_ip(&ip_address);
    }
    
    // Register with full node info (no lock needed — lock-free registry)
    state.registry.insert(node_id.clone(), ctrl, node_info.clone());
    // Register with heartbeat monitor so the health check loop tracks this node
    state.heartbeat_monitor.register_provider(&node_id).await;

    // Register node with Control API for Explorer visibility
    let control_api = state.control_api.clone();
    let registration_node_id = node_id.clone();
    let registration_user_id = user_id.clone();
    let registration_ip = ip_address.clone();
    let registration_region = node_info.region.clone();
    let registration_country = node_info.country_code.clone();
    let registration_isp = node_info.ip_address.clone(); // Using IP as ISP placeholder
    
    // Spawn registration task (non-blocking)
    tokio::spawn(async move {
        let req = crate::control_api::RegisterNodeRequest {
            provider_user_id: registration_user_id,
            node_id: registration_node_id.clone(),
            ip_address: registration_ip,
            port: 0, // Will be updated when known
            region: registration_region,
            country_code: registration_country,
            city: "Unknown".to_string(),
            isp: registration_isp,
            connection_type: "residential".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
        };
        
        match control_api.register_node(&req).await {
            Ok(resp) => {
                info!("✅ Node registered with Control API: {} -> DB ID: {}", 
                    registration_node_id, resp.id);
            }
            Err(e) => {
                warn!("⚠️  Failed to register node with Control API: {}", e);
                // Don't fail the connection - node will work but won't appear in explorer
            }
        }
    });

    info!("✅ Provider connected: {} from {}", node_id, peer_addr);

    // Start background heartbeat task for Control API (sends every 30 seconds)
    let heartbeat_state = state.clone();
    let heartbeat_node_id = node_id.clone();
    let heartbeat_user_id = user_id.clone();
    let heartbeat_handle = tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
        loop {
            interval.tick().await;
            
            // Get node info for stats
            let node_info = heartbeat_state.registry.get_node_info(&heartbeat_node_id);
            let (active_conns, bytes_up, bytes_down, is_healthy) = node_info
                .map(|info| (info.active_connections as i32, 0i64, 0i64, info.is_healthy))
                .unwrap_or((0, 0, 0, true));
            
            // TODO: We need the DB node ID to send heartbeat. 
            // For now, we'll rely on the node registration creating the entry,
            // and the Control API's NodeSync will pick up heartbeats from Redis.
            // In a full implementation, we'd store the DB node ID and call:
            // heartbeat_state.control_api.send_heartbeat(&db_node_id, &req).await
            
            trace!("Control API heartbeat tick for {}", heartbeat_node_id);
        }
    });

    // Drive connection - accept incoming streams
    while let Some(result) = incoming.next().await {
        match result {
            Ok(mut stream) => {
                // Handle control messages (like heartbeats)
                use tokio::io::AsyncReadExt;
                let mut buf = [0u8; 1024];
                match stream.read(&mut buf).await {
                    Ok(n) if n > 0 => {
                        // Parse control frame: "HEARTBEAT:<node_id>:<timestamp>:<status_json>"
                        let data = &buf[..n];
                        if let Ok(msg) = String::from_utf8(data.to_vec()) {
                            if msg.starts_with("HEARTBEAT:") {
                                let parts: Vec<&str> = msg.splitn(4, ':').collect();
                                if parts.len() >= 3 {
                                    let hb_node_id = parts[1];
                                    let timestamp = parts[2].parse::<u64>().unwrap_or(0);
                                    let status = parts.get(3).map(|s| s.to_string());
                                    
                                    // Update heartbeat
                                    if hb_node_id == node_id {
                                        state.heartbeat_store.update(&node_id, timestamp, status).await;
                                        // Notify in-memory monitor (resets miss counter)
                                        let _ = state.heartbeat_monitor.record_heartbeat(&node_id, 0).await;
                                        // Mark as healthy (atomic, no lock)
                                        state.registry.mark_healthy(&node_id);
                                        trace!("Received heartbeat from {}", node_id);
                                    }
                                }
                            } else if msg.starts_with("STATS:") {
                                // Handle stats updates
                                trace!("Received stats from {}: {}", node_id, msg);
                            }
                        }
                    }
                    Ok(_) => {}
                    Err(e) => {
                        trace!("Read error on control stream for {}: {}", node_id, e);
                    }
                }
            }
            Err(e) => {
                error!("Stream error for {}: {}", node_id, e);
                state.registry.mark_unhealthy(&node_id);
                break;
            }
        }
    }
    
    // Cancel background heartbeat task
    heartbeat_handle.abort();
    
    // Cleanup and Persist Stats
    {
        // 1. Grab final stats then remove from lock-free registry
        let final_info = state.registry.remove(&node_id);

        // 2. Persist to Redis
        if let Some(info) = final_info {
            if let Err(e) = state.registry_store.save_node(&user_id, &info).await {
                error!("Failed to persist node metadata: {}", e);
            } else {
                info!("💾 Persisted node stats for {}", node_id);
            }
        }

        // 3. Unregister from heartbeat monitor
        state.heartbeat_monitor.unregister_provider(&node_id).await;

        // 4. Evict any pooled streams for this node
        state.connection_pool.evict_node(&node_id);
        
        // 5. Update Control API status to offline (best effort)
        let control_api = state.control_api.clone();
        let node_id_clone = node_id.clone();
        tokio::spawn(async move {
            // Note: We need the DB node ID to update status properly
            // The node will naturally age out in Control API based on last_seen_at
            debug!("Provider {} disconnected, status will age out in Control API", node_id_clone);
        });
    }
    info!("❌ Provider disconnected: {}", node_id);
}

/// Placeholder for GeoIP country detection
fn detect_country_from_ip(ip: &str) -> String {
    if ip.starts_with("41.") || ip.starts_with("197.") || ip.starts_with("154.") {
        return "GH".to_string();
    }
    if ip.starts_with("102.") || ip.starts_with("105.") {
        return "NG".to_string();
    }
    if ip.starts_with("41.89.") || ip.starts_with("41.90.") {
        return "KE".to_string();
    }
    if ip.starts_with("127.") || ip.starts_with("192.168.") || ip.starts_with("10.") {
        return "LOCAL".to_string();
    }
    "UNKNOWN".to_string()
}

/// Placeholder for GeoIP region detection
fn detect_region_from_ip(ip: &str) -> String {
    if ip.starts_with("127.") || ip.starts_with("192.168.") || ip.starts_with("10.") {
        return "Local".to_string();
    }
    "Unknown".to_string()
}

/// P1-A6: Calculate assigned limits based on provider capabilities
fn calculate_assigned_limits(caps: &ProviderCapabilities) -> AssignedLimits {
    // Right-size based on declared capabilities
    let max_conns = if caps.cpu_cores >= 8 && caps.memory_mb >= 16384 {
        caps.max_connections.min(500)  // High-end server
    } else if caps.cpu_cores >= 4 && caps.memory_mb >= 8192 {
        caps.max_connections.min(200)  // Mid-range
    } else if caps.cpu_cores >= 2 && caps.memory_mb >= 4096 {
        caps.max_connections.min(100)  // Low-end
    } else {
        caps.max_connections.min(50)   // Minimal (Raspberry Pi, etc.)
    };
    
    // Bandwidth cap based on downlink speed
    let bw_cap = caps.downlink_speed_kbps.min(1_000_000) / 1000; // Cap at 1 Gbps
    let effective_bw_cap = bw_cap.min(caps.max_bandwidth_mbps);
    
    // Determine QoS tier based on connection quality
    let (qos_tier, priority) = match caps.connection_type.as_str() {
        "fiber" if caps.downlink_speed_kbps >= 100_000 => ("premium", 90),
        "fiber" if caps.downlink_speed_kbps >= 50_000 => ("standard", 70),
        "cable" if caps.downlink_speed_kbps >= 50_000 => ("standard", 60),
        "cable" | "fiber" => ("basic", 50),
        "dsl" => ("basic", 40),
        "mobile" if caps.downlink_speed_kbps >= 20_000 => ("basic", 35),
        "mobile" => ("limited", 20),
        "satellite" => ("limited", 10),
        _ => ("basic", 40),
    };
    
    // Adjust priority based on hardware capability
    let adjusted_priority = if caps.cpu_cores >= 4 && caps.memory_mb >= 8192 {
        priority + 5
    } else {
        priority
    };
    
    AssignedLimits {
        max_connections: max_conns,
        bandwidth_cap_mbps: effective_bw_cap,
        allowed_ports: caps.available_ports.clone(),
        qos_tier: qos_tier.to_string(),
        priority: adjusted_priority.min(100),
    }
}

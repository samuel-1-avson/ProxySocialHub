use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio_util::compat::TokioAsyncReadCompatExt;
use yamux::{Config, Connection, Mode, WindowUpdateMode};
use crate::state::{AppState, NodeInfo};
use crate::tls::{TlsConfig, create_tls_acceptor, is_tls_enabled};
use futures_util::{StreamExt, AsyncReadExt, AsyncWriteExt};
use tracing::{info, warn, error, trace};
use jsonwebtoken::{decode, DecodingKey, Validation, Algorithm};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    user_id: String,
    role: String,
    exp: usize,
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

    info!("✅ Provider connected: {} from {}", node_id, peer_addr);

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

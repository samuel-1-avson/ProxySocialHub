use std::net::SocketAddr;
use std::sync::Arc;
use std::pin::Pin;
use tokio::net::TcpListener;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio_util::compat::TokioAsyncReadCompatExt;
use yamux::{Config, Connection, Mode, WindowUpdateMode};
use crate::state::{AppState, NodeInfo};
use crate::tls::{TlsConfig, create_tls_acceptor, is_tls_enabled};
use uuid::Uuid;
use futures_util::StreamExt;

pub async fn run_tunnel_server(port: u16, state: Arc<AppState>) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = TcpListener::bind(addr).await?;
    
    // Check if TLS is enabled
    let tls_acceptor = if is_tls_enabled() {
        match TlsConfig::from_env() {
            Some(config) => {
                match create_tls_acceptor(&config) {
                    Ok(acceptor) => {
                        println!("🔐 Tunnel Server listening on {} (TLS enabled)", addr);
                        if config.require_client_cert {
                            println!("   mTLS: Client certificate required");
                        }
                        Some(acceptor)
                    }
                    Err(e) => {
                        eprintln!("⚠️  Failed to create TLS acceptor: {}", e);
                        println!("Tunnel Server listening on {} (TLS disabled - fallback)", addr);
                        None
                    }
                }
            }
            None => {
                println!("Tunnel Server listening on {} (TLS not configured)", addr);
                None
            }
        }
    } else {
        println!("Tunnel Server listening on {} (plaintext)", addr);
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
                        println!("🔐 TLS handshake successful with {}", peer_addr);
                        handle_provider_connection(tls_stream, peer_addr, state).await;
                    }
                    Err(e) => {
                        eprintln!("❌ TLS handshake failed with {}: {}", peer_addr, e);
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
    let incoming = yamux::into_stream(conn);
    tokio::pin!(incoming);
    
    // Generate a random Node ID
    let node_id = Uuid::new_v4().to_string();
    
    // Create node info with peer address
    let ip_address = peer_addr.ip().to_string();
    let mut node_info = NodeInfo::new(node_id.clone(), ip_address.clone());
    
    // Detect location (placeholder)
    node_info.country_code = detect_country_from_ip(&ip_address);
    node_info.region = detect_region_from_ip(&ip_address);
    
    // Register with full node info
    {
        let mut registry = state.registry.lock().unwrap();
        registry.insert(node_id.clone(), ctrl, node_info);
    }
    
    println!("✅ Provider connected: {} from {}", node_id, peer_addr);

    // Drive connection - accept incoming streams
    while let Some(result) = incoming.next().await {
        match result {
            Ok(_stream) => {
                println!("Provider opened a stream (unexpected for outbound tunnel)");
            }
            Err(e) => {
                eprintln!("Stream error for {}: {}", node_id, e);
                {
                    let mut registry = state.registry.lock().unwrap();
                    registry.mark_unhealthy(&node_id);
                }
                break;
            }
        }
    }
    
    // Cleanup
    {
        let mut registry = state.registry.lock().unwrap();
        registry.remove(&node_id);
    }
    println!("❌ Provider disconnected: {}", node_id);
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

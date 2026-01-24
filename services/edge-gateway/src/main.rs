use std::sync::Arc;

use http_body_util::Full;
use hyper::body::Bytes;
use hyper::header::{HeaderValue, PROXY_AUTHORIZATION};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use tokio::net::TcpListener;
use base64::Engine;
use tracing::{info, warn, error};
use uuid::Uuid;

mod auth;
mod circuitbreaker;
mod config;
mod leader;
mod metering;
mod policy;
mod rotation;
mod state;
mod tls;
mod tunnel;
mod registry; // Register the new module

use crate::auth::SessionAuthenticator;
use crate::circuitbreaker::{CircuitConfig, CircuitError};
use crate::state::AppState;
use crate::leader::LeaderElector;
use crate::registry::store::RegistryStore;

// ... (existing imports and code)

/// Extract username from Proxy-Authorization header
/// Format: "Basic base64(username:password)"
fn extract_proxy_auth(header: Option<&HeaderValue>) -> Option<(String, String)> {
    let header = header?;
    let value = header.to_str().ok()?;
    
    if !value.starts_with("Basic ") {
        return None;
    }
    
    let encoded = &value[6..];
    let decoded = base64::engine::general_purpose::STANDARD.decode(encoded).ok()?;
    let decoded_str = String::from_utf8(decoded).ok()?;
    
    let parts: Vec<&str> = decoded_str.splitn(2, ':').collect();
    if parts.len() != 2 {
        return None;
    }
    
    Some((parts[0].to_string(), parts[1].to_string()))
}

async fn proxy(
    req: Request<hyper::body::Incoming>,
    state: Arc<AppState>,
    authenticator: Arc<SessionAuthenticator>,
) -> Result<Response<Full<Bytes>>, hyper::Error> {
    if Method::CONNECT == req.method() {
        // Extract and validate authentication
        let auth_header = req.headers().get(PROXY_AUTHORIZATION);
        let credentials = extract_proxy_auth(auth_header);
        
        // Extract session data for routing decisions
        let (session_username, session_data) = match credentials {
            Some((username, _password)) => {
                // Validate session in Redis
                match authenticator.validate_session(&username).await {
                    Ok(Some(session)) => {
                        info!("✅ Authenticated session: {} (Role: {}, Tier: {}, Type: {})", 
                            username, session.user_id, session.trust_tier, session.session_type);
                        (Some(username), Some(session))
                    }
                    Ok(None) => {
                        warn!("❌ Invalid or expired session attempt: {}", username);
                        let mut resp = Response::new(Full::new(Bytes::from("Proxy session invalid, expired, or bandwidth limit reached")));
                        *resp.status_mut() = StatusCode::PROXY_AUTHENTICATION_REQUIRED;
                        resp.headers_mut().insert(
                            "Proxy-Authenticate",
                            HeaderValue::from_static("Basic realm=\"ProxyHub\""),
                        );
                        return Ok(resp);
                    }
                    Err(e) => {
                        error!("🚨 Auth backend error for {}: {}", username, e);
                        // Allow through on Redis failure (graceful degradation) for now to prevent total outage
                        // In high security mode, we should block.
                        (Some("anonymous".to_string()), None)
                    }
                }
            }
            None => {
                // No auth provided - require authentication
                warn!("⚠️ Anonymous CONNECT request rejected");
                let mut resp = Response::new(Full::new(Bytes::from("Proxy authentication required (Credentials missing)")));
                *resp.status_mut() = StatusCode::PROXY_AUTHENTICATION_REQUIRED;
                resp.headers_mut().insert(
                    "Proxy-Authenticate",
                    HeaderValue::from_static("Basic realm=\"ProxyHub\""),
                );
                return Ok(resp);
            }
        };

        // RECEIVED CONNECT REQUEST
        if let Some(addr) = host_addr(req.uri()) {
            // === POLICY CHECK: Validate destination ===
            if let Err(reason) = policy::validate_destination(&addr) {
                warn!("Policy violation: {} -> {}", addr, reason);
                let mut resp = Response::new(Full::new(Bytes::from(format!("Blocked: {}", reason))));
                *resp.status_mut() = StatusCode::FORBIDDEN;
                return Ok(resp);
            }

            let auth_clone = authenticator.clone();
            let username = session_username.unwrap_or_default();

            // Rate Limit Check
            if !state.check_rate_limit(&username) {
                warn!("Rate limit exceeded for user: {}", username);
                let mut resp = Response::new(Full::new(Bytes::from("Rate limit exceeded")));
                *resp.status_mut() = StatusCode::TOO_MANY_REQUESTS;
                return Ok(resp);
            }

            let is_sticky = session_data.as_ref().map(|s| s.session_type == "sticky").unwrap_or(false);
            let session_id = session_data.as_ref().map(|s| s.session_id.clone()).unwrap_or_default();
            
            // 3. PRE-FLIGHT: Select provider BEFORE acting on upgrade
            // This allows us to return 503/504 if no providers are available
            let (provider_control, node_id) = match select_best_provider(state.clone(), &session_id, is_sticky, authenticator.clone()).await {
                Ok(Some(res)) => res,
                Ok(None) => {
                    warn!("No healthy providers available for session {}", session_id);
                    let mut resp = Response::new(Full::new(Bytes::from("No healthy providers available")));
                    *resp.status_mut() = StatusCode::SERVICE_UNAVAILABLE;
                    return Ok(resp);
                }
                Err(e) => {
                    error!("Provider selection error: {}", e);
                    let mut resp = Response::new(Full::new(Bytes::from("Internal Server Error during routing")));
                    *resp.status_mut() = StatusCode::INTERNAL_SERVER_ERROR;
                    return Ok(resp);
                }
            };

            // 4. Return 200 OK to establish tunnel, then bridge in background
            tokio::task::spawn(async move {
                match hyper::upgrade::on(req).await {
                    Ok(upgraded) => {
                        let tunnel_state = state.clone();
                        // Use the PRE-SELECTED provider
                        match bridge_to_provider(
                            upgraded, 
                            addr, 
                            provider_control,
                            node_id,
                            tunnel_state, 
                            auth_clone.clone(),
                            username.clone()
                        ).await {
                            Ok((bytes_up, bytes_down)) => {
                                // Record signed usage for decentralized billing
                                state.usage_tracker.record(&username, bytes_up, bytes_down).await;
                            }
                            Err(e) => {
                                error!("Tunnel error: {}", e);
                            }
                        };
                    }
                    Err(e) => error!("upgrade error: {}", e),
                }
            });
            Ok(Response::new(Full::new(Bytes::new())))
        } else {
            error!("CONNECT host is not socket addr: {:?}", req.uri());
            let mut resp = Response::new(Full::new(Bytes::from("CONNECT must be to a socket address")));
            *resp.status_mut() = StatusCode::BAD_REQUEST;
            Ok(resp)
        }
    } else {
        // STANDARD HTTP REQUEST
        Ok(Response::new(Full::new(Bytes::from("Only CONNECT supported in this minimal checkpoint"))))
    }
}

fn host_addr(uri: &hyper::Uri) -> Option<String> {
    uri.authority().map(|auth| auth.to_string())
}



/// Helper: Select the best provider based on session and load
async fn select_best_provider(
    state: Arc<AppState>,
    session_id: &str,
    is_sticky: bool,
    authenticator: Arc<SessionAuthenticator>,
) -> std::io::Result<Option<(yamux::Control, String)>> {
    // Use configured TTL
    let sticky_ttl_secs = state.config.sticky_ttl_secs;
    
    // 1. Check for existing sticky binding
    let sticky_node_id = if is_sticky && !session_id.is_empty() {
        match authenticator.get_sticky_node(session_id).await {
            Ok(Some(node_id)) => {
                info!("📌 Sticky session {} bound to node {}", session_id, node_id);
                Some(node_id)
            }
            Ok(None) => {
                info!("📌 New sticky session {}, will bind on first connection", session_id);
                None
            }
            Err(e) => {
                error!("Failed to get sticky binding: {}", e);
                None
            }
        }
    } else {
        None
    };
    
    // 2. Select provider (respect sticky binding if exists)
    let selection = {
        let registry = match state.registry.lock() {
            Ok(guard) => guard,
            Err(_poisoned) => {
                error!("Registry lock poisoned!");
                return Err(std::io::Error::new(std::io::ErrorKind::Other, "Registry Lock Poisoned"));
            }
        };
        
        if let Some(ref bound_node_id) = sticky_node_id {
            // Try to get the specific bound node
            if let Some(control) = registry.get_by_id(bound_node_id) {
                info!("📍 Sticky hit: Session {} correctly routed to bound node {}", session_id, bound_node_id);
                Some((control, bound_node_id.clone()))
            } else {
                warn!("📍 Sticky miss: Bound node {} is unavailable for session {}, selecting new best candidate", bound_node_id, session_id);
                if let Some((control, id)) = registry.get_best() {
                    Some((control, id))
                } else {
                    None
                }
            }
        } else {
            // Normal selection: best or random
            if let Some((control, node_id)) = registry.get_best() {
                info!("🎯 Routed to best node {} for session {}", node_id, session_id);
                Some((control, node_id))
            } else if let Some(control) = registry.get_random() {
                info!("🎲 Routed to random node for session {}", session_id);
                Some((control, "random".to_string()))
            } else {
                warn!("🛑 No available nodes found in registry for session {}", session_id);
                None
            }
        }
    };

    // 3. Bind sticky session if new
    if let Some((_, ref node_id)) = selection {
        if is_sticky && sticky_node_id.is_none() && !session_id.is_empty() {
            if let Err(e) = authenticator.set_sticky_node(session_id, node_id, sticky_ttl_secs).await {
                error!("Failed to set sticky binding: {}", e);
            } else {
                info!("📌 Bound sticky session {} to node {}", session_id, node_id);
            }
        }
    }

    Ok(selection)
}

/// Helper: Bridge client connection to selected provider
async fn bridge_to_provider(
    upgraded: hyper::upgrade::Upgraded, 
    addr: String, 
    mut control: yamux::Control,
    node_id: String,
    state: Arc<AppState>,
    auth_clone: Arc<SessionAuthenticator>, // Keep for old reporting compatibility if needed, though we use usage_tracker now
    username: String,
) -> std::io::Result<(u64, u64)> {
    use futures_util::{AsyncReadExt, AsyncWriteExt};
    
    info!("🔗 Routing to provider {} for {}", node_id, addr);

    // 4. Open stream and proxy with circuit breaker protection
    let circuit_config = CircuitConfig {
        failure_threshold: 3,
        timeout: std::time::Duration::from_secs(30),
        success_threshold: 2,
        request_timeout: std::time::Duration::from_secs(30), // Increased timeout for slow proxies
    };
    
    let circuit_breaker = state.circuit_breakers.get_breaker(&node_id, circuit_config).await;
    
    match circuit_breaker.call(|| async {
        let mut stream = control.open_stream().await.map_err(|e| {
            std::io::Error::new(std::io::ErrorKind::ConnectionRefused, format!("Stream open failed: {}", e))
        })?;
        
        // Send CONNECT command
        let command = format!("CONNECT {}\n", addr);
        stream.write_all(command.as_bytes()).await?;

        // Wait for OK
        let mut response_buf = [0u8; 64];
        // Short timeout for handshake only?
        let n = stream.read(&mut response_buf).await?;
        
        let response = String::from_utf8_lossy(&response_buf[..n]);
        if !response.starts_with("OK") {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied, 
                format!("Provider refused: {}", response.trim())
            ));
        }
        
        Ok(stream)
    }).await {
        Ok(mut stream) => {
            info!("🔗 Connected to provider {} for {}", node_id, addr);
            
            // Bridge connections
            use tokio_util::compat::FuturesAsyncReadCompatExt;
            let mut stream = stream.compat();
            let mut upgraded = TokioIo::new(upgraded);
            
            // Measure bandwidth for load balancing stats
            let start = std::time::Instant::now();
            
            let (from_client, from_provider) = tokio::io::copy_bidirectional(&mut upgraded, &mut stream).await?;
            
            // Update node stats
            let duration = start.elapsed().as_secs_f64();
            if duration > 0.0 {
                let _bytes_per_sec = (from_client + from_provider) as f64 / duration;
                // Update bandwidth in registry (need a method for this)
                // Since this is heavy, maybe we skip or optimize
                // state.registry.lock().unwrap().update_bandwidth(node_id, bytes_per_sec)
            }
            
            // Report to Auth (Legacy/Backup)
            let total_bytes = from_client + from_provider;
            if let Err(e) = auth_clone.report_usage(&username, total_bytes as i64).await {
                error!("Failed to report usage: {}", e);
            }

            info!("✅ Proxy finished: {} up / {} down", from_client, from_provider);
            Ok((from_client, from_provider))
        },
        Err(CircuitError::Open) => {
            warn!("Circuit breaker open for provider {}", node_id);
            if let Ok(mut registry) = state.registry.lock() {
                registry.mark_unhealthy(&node_id);
            }
            Err(std::io::Error::new(std::io::ErrorKind::ConnectionRefused, "Circuit breaker open"))
        },
        Err(CircuitError::Timeout) => {
            warn!("Timeout connecting to provider {}", node_id);
            if let Ok(mut registry) = state.registry.lock() {
                registry.mark_unhealthy(&node_id);
            }
            Err(std::io::Error::new(std::io::ErrorKind::TimedOut, "Provider connection timeout"))
        },
        Err(CircuitError::Failure(e)) => {
            error!("Failed to connect to provider {}: {}", node_id, e);
            if let Ok(mut registry) = state.registry.lock() {
                registry.mark_unhealthy(&node_id);
            }
            Err(e)
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Initialize tracing
    tracing_subscriber::fmt::init();

    // Load configuration
    let config = config::Config::from_env();
    let addr = config.socket_addr();
    let addr_tunnel = config.tunnel_port;
    let redis_url = config.redis_url.clone();

    // Initialize Redis authenticator
    let authenticator = Arc::new(SessionAuthenticator::new(&config.redis_url)?);
    
    // Initialize Registry Store
    let registry_store = Arc::new(RegistryStore::new(&config.redis_url)?);

    // Initialize Leader Election
    let service_id = Uuid::new_v4().to_string();
    info!("Starting Edge Gateway with Service ID: {}", service_id);
    
    // Create a NEW client for leader election
    let redis_client = redis::Client::open(redis_url)?;
    
    let leader_elector = LeaderElector::new(
        redis_client, 
        service_id.clone(), 
        "edge-gateway-leader".to_string(), 
        30
    );
    let leader_status = leader_elector.status_flag();
    
    tokio::spawn(async move {
        leader_elector.run().await;
    });

    // Initialize Helper: Usage Tracker
    let control_api_url = std::env::var("CONTROL_API_URL").unwrap_or_else(|_| "http://localhost:8000".to_string());
    let usage_tracker = Arc::new(crate::metering::UsageTracker::new(&control_api_url, &config.provider_private_key).expect("Failed to create usage tracker"));
    usage_tracker.clone().start_flush_task();

    // Pass leader status to state
    let state = Arc::new(AppState::new(config, leader_status, registry_store, usage_tracker));

    let listener = TcpListener::bind(addr).await?;
    info!("Edge Gateway Proxy listening on http://{}", addr);

    // Spawn Tunnel Server
    let tunnel_state = state.clone();
    tokio::spawn(async move {
        if let Err(e) = tunnel::run_tunnel_server(addr_tunnel, tunnel_state).await {
            error!("Tunnel server error: {}", e);
        }
    });

    loop {
        tokio::select! {
            res = listener.accept() => {
                match res {
                    Ok((stream, _)) => {
                        let io = TokioIo::new(stream);
                        
                        // Clone state for the request handler
                        let proxy_state = state.clone();
                        let auth_clone = authenticator.clone();

                        tokio::task::spawn(async move {
                             let service = service_fn(move |req| {
                                 let s = proxy_state.clone();
                                 let a = auth_clone.clone();
                                 proxy(req, s, a)
                             });

                            if let Err(err) = http1::Builder::new()
                                .preserve_header_case(true)
                                .title_case_headers(true)
                                .serve_connection(io, service)
                                .with_upgrades()
                                .await
                            {
                                error!("Error serving connection: {:?}", err);
                            }
                        });
                    }
                    Err(e) => error!("Accept error: {}", e),
                }
            }
            _ = tokio::signal::ctrl_c() => {
                info!("Shutting down Edge Gateway...");
                break;
            }
        }
    }
    Ok(())
}
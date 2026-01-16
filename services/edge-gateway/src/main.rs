use std::net::SocketAddr;
use std::sync::Arc;
use std::env;

use http_body_util::Full;
use hyper::body::Bytes;
use hyper::header::{HeaderValue, PROXY_AUTHORIZATION};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use tokio::net::TcpListener;
use base64::Engine;

mod auth;
mod metering;
mod policy;
mod rotation;
mod state;
mod tls;
mod tunnel;

use crate::auth::SessionAuthenticator;
use crate::state::AppState;

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
                        println!("Authenticated session: {} (type: {})", username, session.session_type);
                        (Some(username), Some(session))
                    }
                    Ok(None) => {
                        eprintln!("Invalid or expired session: {}", username);
                        let mut resp = Response::new(Full::new(Bytes::from("Session invalid or expired")));
                        *resp.status_mut() = StatusCode::PROXY_AUTHENTICATION_REQUIRED;
                        resp.headers_mut().insert(
                            "Proxy-Authenticate",
                            HeaderValue::from_static("Basic realm=\"ProxyHub\""),
                        );
                        return Ok(resp);
                    }
                    Err(e) => {
                        eprintln!("Auth error: {}", e);
                        // Allow through on Redis failure (graceful degradation)
                        (Some("anonymous".to_string()), None)
                    }
                }
            }
            None => {
                // No auth provided - require authentication
                let mut resp = Response::new(Full::new(Bytes::from("Proxy authentication required")));
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
                eprintln!("Policy violation: {} -> {}", addr, reason);
                let mut resp = Response::new(Full::new(Bytes::from(format!("Blocked: {}", reason))));
                *resp.status_mut() = StatusCode::FORBIDDEN;
                return Ok(resp);
            }

            let auth_clone = authenticator.clone();
            let username = session_username.unwrap_or_default();
            let is_sticky = session_data.as_ref().map(|s| s.session_type == "sticky").unwrap_or(false);
            let session_id = session_data.as_ref().map(|s| s.session_id.clone()).unwrap_or_default();
            
            tokio::task::spawn(async move {
                match hyper::upgrade::on(req).await {
                    Ok(upgraded) => {
                        let tunnel_state = state.clone();
                        match tunnel_to_provider_with_sticky(
                            upgraded, 
                            addr, 
                            tunnel_state, 
                            auth_clone.clone(),
                            &session_id,
                            is_sticky
                        ).await {
                            Ok((bytes_up, bytes_down)) => {
                                // Report usage
                                let total_bytes = bytes_up + bytes_down;
                                if let Err(e) = auth_clone.report_usage(&username, total_bytes as i64).await {
                                    eprintln!("Failed to report usage: {}", e);
                                }
                            }
                            Err(e) => {
                                eprintln!("server io error: {}", e);
                            }
                        };
                    }
                    Err(e) => eprintln!("upgrade error: {}", e),
                }
            });
            Ok(Response::new(Full::new(Bytes::new())))
        } else {
            eprintln!("CONNECT host is not socket addr: {:?}", req.uri());
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

async fn tunnel_to_provider(upgraded: hyper::upgrade::Upgraded, addr: String, state: Arc<AppState>) -> std::io::Result<(u64, u64)> {
    use futures_util::{AsyncReadExt, AsyncWriteExt};
    use crate::state::SelectionStrategy;
    
    // 1. Select a provider using intelligent routing
    // Try best provider first, fallback to random if none available
    let (control_opt, node_id_opt) = {
        let registry = state.registry.lock().unwrap();
        
        // First try to get the best provider (based on health, latency, load)
        if let Some((control, node_id)) = registry.get_best() {
            (Some(control), Some(node_id))
        } else {
            // Fallback to random
            (registry.get_random(), None)
        }
    };

    if let Some(mut control) = control_opt {
        let node_id = node_id_opt.unwrap_or_else(|| "unknown".to_string());
        println!("Routing to provider {} for {}", node_id, addr);
        
        // 2. Open stream
        match control.open_stream().await {
            Ok(mut stream) => {
                // 3. Send CONNECT Command using futures-io traits 
                let command = format!("CONNECT {}\n", addr);
                if let Err(e) = stream.write_all(command.as_bytes()).await {
                    eprintln!("Failed to write CONNECT command: {}", e);
                    return Err(std::io::Error::new(std::io::ErrorKind::Other, "Provider Write Failed"));
                }

                // 4. Wait for OK\n
                let mut response_buf = [0u8; 64];
                let n = stream.read(&mut response_buf).await.map_err(|e| {
                    std::io::Error::new(std::io::ErrorKind::Other, format!("Read failed: {}", e))
                })?;
                
                let response = String::from_utf8_lossy(&response_buf[..n]);
                if !response.starts_with("OK") {
                    return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, format!("Provider refused: {}", response.trim())));
                }
                
                // 5. Bridge - need to convert between tokio and futures-io
                use tokio_util::compat::FuturesAsyncReadCompatExt;
                let mut stream = stream.compat();
                let mut upgraded = TokioIo::new(upgraded);
                
                let (from_client, from_provider) = tokio::io::copy_bidirectional(&mut upgraded, &mut stream).await?;
                println!("Proxy finished: {} up / {} down", from_client, from_provider);
                Ok((from_client, from_provider))
            },
            Err(e) => {
                eprintln!("Failed to open stream on provider: {}", e);
                Err(std::io::Error::new(std::io::ErrorKind::ConnectionRefused, "Provider Open Stream Failed"))
            }
        }
    } else {
        eprintln!("No providers available");
        Err(std::io::Error::new(std::io::ErrorKind::NotFound, "No Providers Available"))
    }
}

/// Tunnel to provider with sticky session support
async fn tunnel_to_provider_with_sticky(
    upgraded: hyper::upgrade::Upgraded, 
    addr: String, 
    state: Arc<AppState>,
    authenticator: Arc<SessionAuthenticator>,
    session_id: &str,
    is_sticky: bool,
) -> std::io::Result<(u64, u64)> {
    use futures_util::{AsyncReadExt, AsyncWriteExt};
    
    // Default sticky TTL: 10 minutes (configurable per tier in production)
    const STICKY_TTL_SECS: u64 = 600;
    
    // 1. Check for existing sticky binding
    let sticky_node_id = if is_sticky && !session_id.is_empty() {
        match authenticator.get_sticky_node(session_id).await {
            Ok(Some(node_id)) => {
                println!("📌 Sticky session {} bound to node {}", session_id, node_id);
                Some(node_id)
            }
            Ok(None) => {
                println!("📌 New sticky session {}, will bind on first connection", session_id);
                None
            }
            Err(e) => {
                eprintln!("Failed to get sticky binding: {}", e);
                None
            }
        }
    } else {
        None
    };
    
    // 2. Select provider (respect sticky binding if exists)
    let (control_opt, node_id) = {
        let registry = state.registry.lock().unwrap();
        
        if let Some(ref bound_node_id) = sticky_node_id {
            // Try to get the specific bound node
            if let Some((control, _)) = registry.get_best() {
                // In production, we'd lookup by node_id specifically
                // For now, just use best and log
                (Some(control), bound_node_id.clone())
            } else {
                (None, bound_node_id.clone())
            }
        } else {
            // Normal selection: best or random
            if let Some((control, node_id)) = registry.get_best() {
                (Some(control), node_id)
            } else if let Some(control) = registry.get_random() {
                (Some(control), "random".to_string())
            } else {
                (None, String::new())
            }
        }
    };
    
    if let Some(mut control) = control_opt {
        println!("🔗 Routing to provider {} for {}", node_id, addr);
        
        // 3. Bind sticky session if new
        if is_sticky && sticky_node_id.is_none() && !session_id.is_empty() {
            if let Err(e) = authenticator.set_sticky_node(session_id, &node_id, STICKY_TTL_SECS).await {
                eprintln!("Failed to set sticky binding: {}", e);
            } else {
                println!("📌 Bound sticky session {} to node {}", session_id, node_id);
            }
        }
        
        // 4. Open stream and proxy
        match control.open_stream().await {
            Ok(mut stream) => {
                // Send CONNECT command
                let command = format!("CONNECT {}\n", addr);
                if let Err(e) = stream.write_all(command.as_bytes()).await {
                    eprintln!("Failed to write CONNECT command: {}", e);
                    return Err(std::io::Error::new(std::io::ErrorKind::Other, "Provider Write Failed"));
                }

                // Wait for OK
                let mut response_buf = [0u8; 64];
                let n = stream.read(&mut response_buf).await.map_err(|e| {
                    std::io::Error::new(std::io::ErrorKind::Other, format!("Read failed: {}", e))
                })?;
                
                let response = String::from_utf8_lossy(&response_buf[..n]);
                if !response.starts_with("OK") {
                    return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, format!("Provider refused: {}", response.trim())));
                }
                
                // Bridge connections
                use tokio_util::compat::FuturesAsyncReadCompatExt;
                let mut stream = stream.compat();
                let mut upgraded = TokioIo::new(upgraded);
                
                let (from_client, from_provider) = tokio::io::copy_bidirectional(&mut upgraded, &mut stream).await?;
                println!("✅ Proxy finished: {} up / {} down", from_client, from_provider);
                Ok((from_client, from_provider))
            },
            Err(e) => {
                eprintln!("Failed to open stream on provider: {}", e);
                Err(std::io::Error::new(std::io::ErrorKind::ConnectionRefused, "Provider Open Stream Failed"))
            }
        }
    } else {
        eprintln!("No providers available");
        Err(std::io::Error::new(std::io::ErrorKind::NotFound, "No Providers Available"))
    }
}


#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let addr = SocketAddr::from(([0, 0, 0, 0], 3000));
    let addr_tunnel = 4000;

    // Initialize Redis authenticator
    let redis_url = env::var("REDIS_URL").unwrap_or_else(|_| "redis://localhost:6379".to_string());
    let authenticator = Arc::new(SessionAuthenticator::new(&redis_url)?);
    
    let state = Arc::new(AppState::new());

    let listener = TcpListener::bind(addr).await?;
    println!("Edge Gateway Proxy listening on http://{}", addr);

    // Spawn Tunnel Server
    let tunnel_state = state.clone();
    tokio::spawn(async move {
        if let Err(e) = tunnel::run_tunnel_server(addr_tunnel, tunnel_state).await {
            eprintln!("Tunnel server error: {}", e);
        }
    });

    loop {
        let (stream, _) = listener.accept().await?;
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
                println!("Error serving connection: {:?}", err);
            }
        });
    }
}

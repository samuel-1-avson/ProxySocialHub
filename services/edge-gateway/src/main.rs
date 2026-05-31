use std::sync::Arc;

use base64::Engine;
use http_body_util::Full;
use hyper::body::Bytes;
use hyper::header::{HeaderValue, PROXY_AUTHORIZATION};
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use std::time::Instant;
use tokio::net::TcpListener;
use tracing::{error, info, warn};
use uuid::Uuid;

mod auth;
mod billing;
mod blockchain; // P2-A9: Direct gRPC to Blockchain
mod circuitbreaker;
mod config;
mod control_api; // Control API client for node registration
mod error; // Error types
mod heartbeat;
mod leader;
mod metering;
mod metrics;
mod multiregion;
mod policy;
mod pool;
mod pricing; // P2-A10: Real-time Pricing Awareness
mod proxy;
mod qos;
mod redis_pool; // P1-A4: Redis connection pooling
mod registry;
mod rollout;
mod rotation;
mod routing;
mod security;
mod state;
mod tls;
mod tunnel;

use crate::auth::SessionAuthenticator;
use crate::circuitbreaker::{CircuitConfig, CircuitError};
use crate::leader::LeaderElector;
use crate::registry::store::RegistryStore;
use crate::security::honeytoken::sink::handle_malicious_connection;
use crate::state::AppState;

// ... (existing imports and code)

/// Extract proxy auth credentials from `Proxy-Authorization`.
/// Legacy mode uses `username:password` session credentials.
/// V2 intent mode uses `session-intent:<jwt>` or `intent:<jwt>`.
pub(crate) fn extract_proxy_auth(header: Option<&HeaderValue>) -> Option<(String, String)> {
    let header = header?;
    let value = header.to_str().ok()?;

    if !value.starts_with("Basic ") {
        return None;
    }

    let encoded = &value[6..];
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .ok()?;
    let decoded_str = String::from_utf8(decoded).ok()?;

    let parts: Vec<&str> = decoded_str.splitn(2, ':').collect();
    if parts.len() != 2 {
        return None;
    }

    Some((parts[0].to_string(), parts[1].to_string()))
}

pub(crate) async fn sync_session_intent_lifecycle(
    state: Arc<AppState>,
    session: &crate::auth::SessionData,
    lifecycle_state: &str,
    provider_node_id: Option<&str>,
    target_host: Option<&str>,
) {
    if !session.is_session_intent() {
        return;
    }

    if let Err(err) = state
        .control_api
        .update_session_intent_state(
            &session.session_id,
            lifecycle_state,
            provider_node_id,
            target_host,
        )
        .await
    {
        warn!(
            intent_id = %session.session_id,
            lifecycle_state = %lifecycle_state,
            error = %err,
            "Failed to sync session intent lifecycle"
        );
    }
}

pub(crate) async fn sync_session_intent_usage(
    state: Arc<AppState>,
    session: &crate::auth::SessionData,
    provider_node_id: Option<&str>,
    target_host: Option<&str>,
    bytes_up_delta: u64,
    bytes_down_delta: u64,
) {
    if !session.is_session_intent() || (bytes_up_delta == 0 && bytes_down_delta == 0) {
        return;
    }

    let up_delta = bytes_up_delta.min(i64::MAX as u64) as i64;
    let down_delta = bytes_down_delta.min(i64::MAX as u64) as i64;

    if let Err(err) = state
        .control_api
        .update_session_intent_usage(
            &session.session_id,
            provider_node_id,
            target_host,
            up_delta,
            down_delta,
        )
        .await
    {
        warn!(
            intent_id = %session.session_id,
            bytes_up_delta = up_delta,
            bytes_down_delta = down_delta,
            error = %err,
            "Failed to sync session intent usage"
        );
    }
}

pub(crate) async fn finalize_session_intent_ledger(
    state: Arc<AppState>,
    session: &crate::auth::SessionData,
    provider_node_id: Option<&str>,
    target_host: Option<&str>,
    bytes_up_delta: u64,
    bytes_down_delta: u64,
) {
    if !session.is_session_intent() {
        return;
    }

    sync_session_intent_lifecycle(
        state.clone(),
        session,
        "closing",
        provider_node_id,
        target_host,
    )
    .await;
    sync_session_intent_usage(
        state.clone(),
        session,
        provider_node_id,
        target_host,
        bytes_up_delta,
        bytes_down_delta,
    )
    .await;
    sync_session_intent_lifecycle(
        state,
        session,
        "ledger_committed",
        provider_node_id,
        target_host,
    )
    .await;
}

fn full_decentralization_enabled() -> bool {
    std::env::var("FULL_DECENTRALIZATION")
        .ok()
        .map(|v| {
            matches!(
                v.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on" | "full" | "strict"
            )
        })
        .unwrap_or(false)
}

/// Metrics endpoint handler
async fn metrics_handler() -> Result<Response<Full<Bytes>>, hyper::Error> {
    let metrics_text = metrics::gather_metrics();
    let response = Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "text/plain; version=0.0.4")
        .body(Full::new(Bytes::from(metrics_text)))
        .unwrap();
    Ok(response)
}

/// Health check endpoint
async fn health_handler() -> Result<Response<Full<Bytes>>, hyper::Error> {
    let health = format!(
        r#"{{"status":"healthy","uptime_seconds":{}}}"#,
        metrics::uptime_seconds()
    );
    let response = Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "application/json")
        .body(Full::new(Bytes::from(health)))
        .unwrap();
    Ok(response)
}

async fn proxy(
    req: Request<hyper::body::Incoming>,
    state: Arc<AppState>,
    authenticator: Arc<SessionAuthenticator>,
) -> Result<Response<Full<Bytes>>, hyper::Error> {
    let start_time = Instant::now();
    let method = req.method().to_string();

    let path = req.uri().path();
    info!("Request path: {}", path);

    // Handle metrics endpoint
    if path == "/metrics" && method == "GET" {
        info!("Serving metrics endpoint");
        return metrics_handler().await;
    }

    // Handle health endpoint
    if path == "/health" && method == "GET" {
        info!("Serving health endpoint");
        return health_handler().await;
    }

    // Handle ML stats export endpoint (Debug only)
    if config::debug_routes_enabled() && path == "/debug/ml/stats" && method == "GET" {
        info!("Serving ML stats export endpoint");
        let csv = state.feature_cache.to_csv(&state.registry);
        let mut resp = Response::new(Full::new(Bytes::from(csv)));
        resp.headers_mut().insert(
            hyper::header::CONTENT_TYPE,
            HeaderValue::from_static("text/csv"),
        );
        return Ok(resp);
    }

    // Handle node list export endpoint (Debug only)
    if config::debug_routes_enabled() && path == "/debug/nodes" && method == "GET" {
        info!("Serving node list debug endpoint");
        let nodes = state.registry.list_nodes();
        let json = serde_json::to_string(&nodes).unwrap_or_default();
        let mut resp = Response::new(Full::new(Bytes::from(json)));
        resp.headers_mut().insert(
            hyper::header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );
        return Ok(resp);
    }

    // --- Phase 6: Network Status API (Observability) ---
    if config::debug_routes_enabled() && path == "/api/v1/network/status" && req.method() == Method::GET {
        info!("Serving Network Status API");

        #[derive(serde::Serialize)]
        struct NetworkStatus {
            total_nodes: usize,
            healthy_nodes: usize,
            avg_latency: u32,
            top_countries: Vec<String>,
            // Redacted ML scores for the dashboard map
            node_scores: Vec<NodeScore>,
        }

        #[derive(serde::Serialize)]
        struct NodeScore {
            id: String,
            country: String,
            region: String,
            score: f32,
        }

        let nodes = state.registry.list_healthy_with_info();
        let total = state.registry.count();
        let healthy = nodes.len();

        let mut node_scores = Vec::new();
        let mut latency_sum: u64 = 0;
        let mut latency_count: u64 = 0;
        let mut country_counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();

        // Fetch heartbeat latencies from in-memory monitor
        let hb_statuses = state.heartbeat_monitor.get_all_status().await;
        let hb_map: std::collections::HashMap<String, u32> = hb_statuses
            .into_iter()
            .filter(|s| s.latency_ms > 0)
            .map(|s| (s.node_id.clone(), s.latency_ms))
            .collect();

        for (id, _control, info) in &nodes {
            // Build features to get the current score
            let features = state.feature_cache.build_features(info, None);
            let score = state.routing.score_features(&features);

            // Collect latency from heartbeat monitor
            if let Some(&lat) = hb_map.get(id) {
                latency_sum += lat as u64;
                latency_count += 1;
            }

            // Count countries
            if !info.country_code.is_empty() {
                *country_counts.entry(info.country_code.clone()).or_insert(0) += 1;
            }

            node_scores.push(NodeScore {
                id: id.clone(),
                country: info.country_code.clone(),
                region: info.region.clone(),
                score,
            });
        }

        let avg_latency = if latency_count > 0 { (latency_sum / latency_count) as u32 } else { 0 };

        // Top countries by node count
        let mut country_vec: Vec<_> = country_counts.into_iter().collect();
        country_vec.sort_by(|a, b| b.1.cmp(&a.1));
        let top_countries: Vec<String> = country_vec.into_iter().take(5).map(|(c, _)| c).collect();

        let status = NetworkStatus {
            total_nodes: total,
            healthy_nodes: healthy,
            avg_latency,
            top_countries,
            node_scores,
        };

        let json = serde_json::to_string(&status).unwrap_or_default();
        let mut resp = Response::new(Full::new(Bytes::from(json)));
        resp.headers_mut().insert(
            hyper::header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );
        return Ok(resp);
    }

    // --- Phase 4: DDoS + geo-block pre-flight ---
    // Extract client IP from Forwarded / X-Forwarded-For headers (best-effort).
    let client_ip: Option<std::net::IpAddr> = req
        .headers()
        .get("x-forwarded-for")
        .or_else(|| req.headers().get("x-real-ip"))
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .and_then(|s| s.trim().parse().ok());

    if let Some(ip) = client_ip {
        // Geo-block check
        if !state.geo_block.is_allowed(ip) {
            warn!("🌍 Geo-blocked request from {}", ip);
            let mut resp = Response::new(Full::new(Bytes::from("Access denied")));
            *resp.status_mut() = StatusCode::FORBIDDEN;
            return Ok(resp);
        }

        // DDoS rate-limit check
        use crate::security::ddos::RateLimitResult;
        match state.ddos.check(ip) {
            RateLimitResult::Block => {
                warn!("🛑 DDoS hard-block for {}", ip);
                state.reputation.ddos_block(ip);
                let mut resp = Response::new(Full::new(Bytes::from("Too Many Requests")));
                *resp.status_mut() = StatusCode::from_u16(429).unwrap_or(StatusCode::FORBIDDEN);
                return Ok(resp);
            }
            RateLimitResult::Challenge => {
                // Issue a soft challenge token in the response header and let the request proceed
                // with reduced priority.  Full CAPTCHA integration is out of scope here.
                let token = state.challenge.issue();
                warn!("⚠️ DDoS challenge issued to {} (token={})", ip, &token[..8]);
                // Fall through — request is allowed but client should echo the token back.
            }
            RateLimitResult::Allow => {}
        }
    }

    // P-04: HTTP-layer bot detection (UA, header order, request timing signals).
    // JA3/TLS fingerprinting requires raw TCP interception and is deferred.
    {
        use crate::security::fingerprint::{BotClassifier, RequestProfile};

        let ua = req
            .headers()
            .get(hyper::header::USER_AGENT)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        let header_names: Vec<&str> = req.headers().keys().map(|k| k.as_str()).collect();
        let header_order_hash = RequestProfile::hash_header_order(&header_names);

        let profile = RequestProfile {
            ip: client_ip.unwrap_or(std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED)),
            user_agent: ua,
            ja3: None, // JA3 requires raw TLS bytes before HTTP layer
            h2: None,
            request_interval_ms: 0, // per-request tracking not available at this layer
            header_order_hash,
        };

        let bot_score = BotClassifier::score(&profile);
        if bot_score.is_likely_bot() {
            warn!(
                "🤖 Bot detected (score={:.2}) from {:?}",
                bot_score.0, client_ip
            );
            metrics::record_policy_block("bot_detected");
            let mut resp = Response::new(Full::new(Bytes::from("Forbidden")));
            *resp.status_mut() = StatusCode::FORBIDDEN;
            return Ok(resp);
        }
    }

    // WebSocket upgrade — client tunnels TCP over WS frames (Phase 2)
    if proxy::websocket::is_websocket(&req) {
        info!("WebSocket upgrade request for {}", path);
        return proxy::websocket::handle_ws_upgrade(req, state, authenticator).await;
    }

    if Method::CONNECT == req.method() {
        // Record connection started
        metrics::connection_started();

        // Extract and validate authentication
        let auth_header = req.headers().get(PROXY_AUTHORIZATION);
        let credentials = extract_proxy_auth(auth_header);

        // Extract session data for routing decisions
        let (session_username, session_data) = match credentials {
            Some((username, password)) => {
                match authenticator
                    .resolve_proxy_auth(&username, &password, &state.config.session_intent_signing_secret)
                    .await
                {
                    Ok(Some(resolved)) => {
                        info!(
                            "✅ Authenticated session: {} (Role: {}, Tier: {}, Type: {})",
                            resolved.username,
                            resolved.session.user_id,
                            resolved.session.trust_tier,
                            resolved.session.session_type
                        );

                        // Update active sessions metric
                        metrics::ACTIVE_SESSIONS.inc();

                        // Record geographic connection if available
                        if !resolved.session.target_geo.is_empty() {
                            metrics::record_connection_by_country(&resolved.session.target_geo);
                        }

                        (Some(resolved.username), Some(resolved.session))
                    }
                    Ok(None) => {
                        warn!("❌ Invalid or expired session attempt: {}", username);
                        metrics::record_auth_failure("invalid_or_expired");

                        let mut resp = Response::new(Full::new(Bytes::from(
                            "Proxy session invalid, expired, or bandwidth limit reached",
                        )));
                        *resp.status_mut() = StatusCode::PROXY_AUTHENTICATION_REQUIRED;
                        resp.headers_mut().insert(
                            "Proxy-Authenticate",
                            HeaderValue::from_static("Basic realm=\"ProxyHub\""),
                        );

                        // Record latency
                        metrics::REQUEST_LATENCY_SECONDS
                            .with_label_values(&[&method, "407"])
                            .observe(start_time.elapsed().as_secs_f64());

                        return Ok(resp);
                    }
                    Err(e) => {
                        error!("🚨 Auth backend error for {}: {}", username, e);
                        metrics::record_connection_error("auth_backend");
                        metrics::record_auth_failure("auth_backend_error");
                        // Fail-closed: NEVER allow anonymous access on backend failure.
                        let mut resp = Response::new(Full::new(Bytes::from(
                            "Authentication service temporarily unavailable. Please retry.",
                        )));
                        *resp.status_mut() = StatusCode::PROXY_AUTHENTICATION_REQUIRED;
                        resp.headers_mut().insert(
                            "Proxy-Authenticate",
                            HeaderValue::from_static("Basic realm=\"ProxyHub\""),
                        );
                        metrics::REQUEST_LATENCY_SECONDS
                            .with_label_values(&[&method, "407"])
                            .observe(start_time.elapsed().as_secs_f64());
                        return Ok(resp);
                    }
                }
            }
            None => {
                // No auth provided - require authentication
                warn!("⚠️ Anonymous CONNECT request rejected");
                metrics::record_auth_failure("missing_credentials");

                let mut resp = Response::new(Full::new(Bytes::from(
                    "Proxy authentication required (Credentials missing)",
                )));
                *resp.status_mut() = StatusCode::PROXY_AUTHENTICATION_REQUIRED;
                resp.headers_mut().insert(
                    "Proxy-Authenticate",
                    HeaderValue::from_static("Basic realm=\"ProxyHub\""),
                );

                // Record latency
                metrics::REQUEST_LATENCY_SECONDS
                    .with_label_values(&[&method, "407"])
                    .observe(start_time.elapsed().as_secs_f64());

                return Ok(resp);
            }
        };

        // RECEIVED CONNECT REQUEST
        if let Some(addr) = host_addr(req.uri()) {
            // === POLICY CHECK: Validate destination ===
            if let Err(reason) = policy::validate_destination(&addr) {
                warn!("Policy violation: {} -> {}", addr, reason);
                metrics::record_policy_block(&reason);

                let mut resp =
                    Response::new(Full::new(Bytes::from(format!("Blocked: {}", reason))));
                *resp.status_mut() = StatusCode::FORBIDDEN;

                // Record latency
                metrics::REQUEST_LATENCY_SECONDS
                    .with_label_values(&[&method, "403"])
                    .observe(start_time.elapsed().as_secs_f64());

                return Ok(resp);
            }

            let auth_clone = authenticator.clone();
            let username = session_username.unwrap_or_default();

            // N-02: Session-level domain filter enforcement
            if let Some(ref sd) = session_data {
                // Extract destination host (strip port)
                let dest_host = addr.split(':').next().unwrap_or(&addr);

                // Blocked-domain check (blacklist wins over whitelist)
                if sd
                    .blocked_domains
                    .iter()
                    .any(|d| dest_host == d || dest_host.ends_with(&format!(".{}", d)))
                {
                    warn!(
                        "Session domain block: {} blocked for {}",
                        dest_host, username
                    );
                    metrics::record_policy_block("session_blocked_domain");
                    let mut resp = Response::new(Full::new(Bytes::from(
                        "Destination blocked by session policy",
                    )));
                    *resp.status_mut() = StatusCode::FORBIDDEN;
                    metrics::REQUEST_LATENCY_SECONDS
                        .with_label_values(&[&method, "403"])
                        .observe(start_time.elapsed().as_secs_f64());
                    return Ok(resp);
                }

                // Allowed-domain whitelist (if non-empty, only listed domains pass)
                if !sd.allowed_domains.is_empty() {
                    let allowed = sd
                        .allowed_domains
                        .iter()
                        .any(|d| dest_host == d || dest_host.ends_with(&format!(".{}", d)));
                    if !allowed {
                        warn!(
                            "Session domain whitelist: {} not allowed for {}",
                            dest_host, username
                        );
                        metrics::record_policy_block("session_domain_not_whitelisted");
                        let mut resp = Response::new(Full::new(Bytes::from(
                            "Destination not in session allowlist",
                        )));
                        *resp.status_mut() = StatusCode::FORBIDDEN;
                        metrics::REQUEST_LATENCY_SECONDS
                            .with_label_values(&[&method, "403"])
                            .observe(start_time.elapsed().as_secs_f64());
                        return Ok(resp);
                    }
                }

                // Time-limit enforcement
                if sd.time_limit_minutes > 0 {
                    // session_data.created_at is not in the Rust struct yet; enforce via
                    // bandwidth revalidation callback in bridge_tracked instead.
                    // Placeholder: future improvement — add created_at to SessionData.
                }
            }

            // Rate Limit Check
            if !state.check_rate_limit(&username) {
                warn!("Rate limit exceeded for user: {}", username);
                metrics::record_rate_limit_hit("connection_rate");

                let mut resp = Response::new(Full::new(Bytes::from("Rate limit exceeded")));
                *resp.status_mut() = StatusCode::TOO_MANY_REQUESTS;

                // Record latency
                metrics::REQUEST_LATENCY_SECONDS
                    .with_label_values(&[&method, "429"])
                    .observe(start_time.elapsed().as_secs_f64());

                return Ok(resp);
            }

            let is_sticky = session_data
                .as_ref()
                .map(|s| s.session_type == "sticky")
                .unwrap_or(false);
            let session_id = session_data
                .as_ref()
                .map(|s| s.session_id.clone())
                .unwrap_or_default();
            let session_type = session_data
                .as_ref()
                .map(|s| s.session_type.clone())
                .unwrap_or_else(|| "unknown".to_string());
            // 2.5 Security: Anomaly Detection (P4-W14)
            if state.anomaly.record_request(&session_id) {
                warn!("⚠️ Anomaly detected for session {}: High RPM", session_id);
                metrics::record_policy_block("anomaly_high_rpm");
                // For now, we just warn and label the session, but we could block here.
            }

            // 3. PRE-FLIGHT: Select provider BEFORE acting on upgrade
            // This allows us to return 503/504 if no providers are available
            let dest_host = addr.split(':').next().unwrap_or(&addr).to_string();

            // 2.6 Security: Honeytokens (P4-W13)
            if let Some(token_type) = state.honeytoken.check(&dest_host) {
                warn!(
                    "🪤 Honeytoken hit! Session {} attempted to access {:?}",
                    session_id, token_type
                );
                metrics::record_policy_block("honeytoken_hit");

                // Phase 8: Trigger On-Chain Slash
                let state_cloned = state.clone();
                let provider_cloned = "unknown_provider".to_string();
                tokio::spawn(async move {
                    let _ = state_cloned
                        .solana_relayer
                        .trigger_slash(
                            &provider_cloned,
                            &format!("Honeytoken Hit: {:?}", token_type),
                            500, // Slash 500 PHUBB tokens
                        )
                        .await;
                });

                // MALICIOUS SINK: Instead of selecting a real provider, we bridge to the sink.
                let (mut sink_tx, sink_rx) = tokio::io::duplex(4096);
                tokio::spawn(async move {
                    let _ = handle_malicious_connection(sink_rx).await;
                });

                let upgraded = match hyper::upgrade::on(req).await {
                    Ok(up) => up,
                    Err(e) => {
                        error!("Upgrade error on honeytoken: {}", e);
                        return Err(e);
                    }
                };

                tokio::spawn(async move {
                    let mut upgraded_io = hyper_util::rt::TokioIo::new(upgraded);
                    let _ = tokio::io::copy_bidirectional(&mut upgraded_io, &mut sink_tx).await;
                });

                return Ok(Response::builder()
                    .status(StatusCode::SWITCHING_PROTOCOLS)
                    .body(Full::new(Bytes::new()))
                    .unwrap());
            }

            let (provider_control, node_id) = match select_best_provider(
                state.clone(),
                &session_id,
                is_sticky,
                authenticator.clone(),
                session_data.as_ref().and_then(|session| {
                    if session.target_geo.is_empty() {
                        None
                    } else {
                        Some(session.target_geo.as_str())
                    }
                }),
                Some(&dest_host),
            )
            .await
            {
                Ok(Some(res)) => res,
                Ok(None) => {
                    warn!("No healthy providers available for session {}", session_id);
                    metrics::record_connection_error("no_providers");

                    let mut resp =
                        Response::new(Full::new(Bytes::from("No healthy providers available")));
                    *resp.status_mut() = StatusCode::SERVICE_UNAVAILABLE;

                    // Record latency
                    metrics::REQUEST_LATENCY_SECONDS
                        .with_label_values(&[&method, "503"])
                        .observe(start_time.elapsed().as_secs_f64());

                    return Ok(resp);
                }
                Err(e) => {
                    error!("Provider selection error: {}", e);
                    metrics::record_connection_error("provider_selection");

                    let mut resp = Response::new(Full::new(Bytes::from(
                        "Internal Server Error during routing",
                    )));
                    *resp.status_mut() = StatusCode::INTERNAL_SERVER_ERROR;

                    // Record latency
                    metrics::REQUEST_LATENCY_SECONDS
                        .with_label_values(&[&method, "500"])
                        .observe(start_time.elapsed().as_secs_f64());

                    return Ok(resp);
                }
            };

            // N-01: Enforce provider node-level policy (blocked_ports, allowed_ports,
            // blocked_domains, allowed_domains) fetched from Redis node:config cache.
            {
                let dest_host = addr.split(':').next().unwrap_or(&addr);
                let dest_port: i64 = addr
                    .split(':')
                    .last()
                    .and_then(|p| p.parse().ok())
                    .unwrap_or(443);

                if let Some(ncfg) = authenticator.get_node_config(&node_id).await {
                    // Port: blocked list checked first
                    if ncfg.blocked_ports.contains(&dest_port) {
                        warn!(
                            "N-01: port {} blocked by node {} policy",
                            dest_port, node_id
                        );
                        metrics::record_policy_block("node_blocked_port");
                        let mut resp = Response::new(Full::new(Bytes::from(
                            "Destination port blocked by provider policy",
                        )));
                        *resp.status_mut() = StatusCode::FORBIDDEN;
                        metrics::REQUEST_LATENCY_SECONDS
                            .with_label_values(&[&method, "403"])
                            .observe(start_time.elapsed().as_secs_f64());
                        return Ok(resp);
                    }
                    // Port: allowed whitelist (non-empty → only listed ports pass)
                    if !ncfg.allowed_ports.is_empty() && !ncfg.allowed_ports.contains(&dest_port) {
                        warn!(
                            "N-01: port {} not in allowlist for node {}",
                            dest_port, node_id
                        );
                        metrics::record_policy_block("node_port_not_whitelisted");
                        let mut resp = Response::new(Full::new(Bytes::from(
                            "Destination port not allowed by provider policy",
                        )));
                        *resp.status_mut() = StatusCode::FORBIDDEN;
                        metrics::REQUEST_LATENCY_SECONDS
                            .with_label_values(&[&method, "403"])
                            .observe(start_time.elapsed().as_secs_f64());
                        return Ok(resp);
                    }
                    // Domain: blocked list
                    if ncfg
                        .blocked_domains
                        .iter()
                        .any(|d| dest_host == d || dest_host.ends_with(&format!(".{}", d)))
                    {
                        warn!(
                            "N-01: domain {} blocked by node {} policy",
                            dest_host, node_id
                        );
                        metrics::record_policy_block("node_blocked_domain");
                        let mut resp = Response::new(Full::new(Bytes::from(
                            "Destination domain blocked by provider policy",
                        )));
                        *resp.status_mut() = StatusCode::FORBIDDEN;
                        metrics::REQUEST_LATENCY_SECONDS
                            .with_label_values(&[&method, "403"])
                            .observe(start_time.elapsed().as_secs_f64());
                        return Ok(resp);
                    }
                    // Domain: allowed whitelist
                    if !ncfg.allowed_domains.is_empty() {
                        let ok = ncfg
                            .allowed_domains
                            .iter()
                            .any(|d| dest_host == d || dest_host.ends_with(&format!(".{}", d)));
                        if !ok {
                            warn!(
                                "N-01: domain {} not in allowlist for node {}",
                                dest_host, node_id
                            );
                            metrics::record_policy_block("node_domain_not_whitelisted");
                            let mut resp = Response::new(Full::new(Bytes::from(
                                "Destination domain not allowed by provider policy",
                            )));
                            *resp.status_mut() = StatusCode::FORBIDDEN;
                            metrics::REQUEST_LATENCY_SECONDS
                                .with_label_values(&[&method, "403"])
                                .observe(start_time.elapsed().as_secs_f64());
                            return Ok(resp);
                        }
                    }
                }
            }

            // 4. Return 200 OK to establish tunnel, then bridge in background
            let session_type_clone = session_type.clone();
            tokio::task::spawn(async move {
                match hyper::upgrade::on(req).await {
                    Ok(upgraded) => {
                        let tunnel_state = state.clone();
                        let tunnel_start = Instant::now();

                        // Use the PRE-SELECTED provider
                        // P-02: Record connection for prewarm demand pattern.
                        {
                            let hour = (std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_secs()
                                / 3600
                                % 24) as u8;
                            state.prewarm.record_connection(&node_id, hour);
                        }

                        let bandwidth_cap: u32 = 0; // 0 = unlimited
                        match bridge_to_provider(
                            upgraded,
                            addr,
                            provider_control,
                            node_id.clone(),
                            tunnel_state,
                            auth_clone.clone(),
                            username.clone(),
                            session_data.clone(),
                            bandwidth_cap,
                            Some(dest_host),
                        )
                        .await
                        {
                            Ok((bytes_up, bytes_down)) => {
                                // Record signed usage for decentralized billing
                                state
                                    .usage_tracker
                                    .record(&username, bytes_up, bytes_down)
                                    .await;

                                // Record connection ended with bandwidth
                                metrics::connection_ended(bytes_up, bytes_down);

                                // Record provider bandwidth
                                metrics::record_provider_bandwidth(&node_id, bytes_up, bytes_down);

                                // Record session duration
                                let duration = tunnel_start.elapsed().as_secs_f64();
                                metrics::record_session_duration(&session_type_clone, duration);

                                // Phase 9: ZK Generation & Batch Proof Submission
                                let state_zk = state.clone();
                                let username_zk = username.clone();
                                let session_id_zk = session_id.clone();
                                if full_decentralization_enabled() {
                                    info!(
                                        session_id = %session_id_zk,
                                        user = %username_zk,
                                        "FULL_DECENTRALIZATION enabled: skipping legacy edge-side ZK/Solana submission path"
                                    );
                                } else if !state_zk.config.legacy_edge_zk_submission_enabled {
                                    info!(
                                        session_id = %session_id_zk,
                                        user = %username_zk,
                                        "Legacy edge-side ZK/Solana submission path disabled: control-api batch settlement is canonical"
                                    );
                                } else if let (Some(zk_prover), Some(batch_relayer)) = (
                                    state_zk.zk_prover.clone(),
                                    state_zk.solana_batch_relayer.clone(),
                                ) {
                                    warn!(
                                        session_id = %session_id_zk,
                                        user = %username_zk,
                                        "LEGACY_EDGE_ZK_SUBMISSION_ENABLED is on: using deprecated edge-side Groth16 batch submission path"
                                    );
                                    tokio::spawn(async move {
                                        let provider_pubkey = state_zk.solana_relayer.provider_pubkey();
                                        if let Some(proof) = zk_prover
                                            .prove_usage(
                                                &session_id_zk,
                                                bytes_up,
                                                bytes_down,
                                                &provider_pubkey,
                                            )
                                            .await
                                        {
                                            // Derive session_id_hash from session_id string
                                            let session_hash = {
                                                use sha2::{Sha256, Digest};
                                                let mut h = Sha256::new();
                                                h.update(session_id_zk.as_bytes());
                                                let result = h.finalize();
                                                let mut out = [0u8; 32];
                                                out.copy_from_slice(&result);
                                                out
                                            };
                                            let inputs = crate::billing::zk::PublicInputs {
                                                session_id_hash: session_hash,
                                                total_bytes_up: bytes_up,
                                                total_bytes_down: bytes_down,
                                                provider_pubkey,
                                            };
                                            batch_relayer.add_proof(proof, inputs).await;
                                        }
                                    });
                                } else {
                                    warn!(
                                        session_id = %session_id_zk,
                                        user = %username_zk,
                                        "Legacy edge-side ZK/Solana submission path requested but runtime is unavailable"
                                    );
                                }

                                // Decrement active sessions
                                metrics::ACTIVE_SESSIONS.dec();
                            }
                            Err(e) => {
                                error!("Tunnel error: {}", e);
                                metrics::record_connection_error("tunnel");
                                metrics::connection_ended(0, 0);
                                metrics::ACTIVE_SESSIONS.dec();
                            }
                        };
                    }
                    Err(e) => {
                        error!("upgrade error: {}", e);
                        metrics::record_connection_error("upgrade");
                        metrics::connection_ended(0, 0);
                        metrics::ACTIVE_SESSIONS.dec();
                    }
                }
            });

            // Record successful connection latency
            metrics::REQUEST_LATENCY_SECONDS
                .with_label_values(&[&method, "200"])
                .observe(start_time.elapsed().as_secs_f64());

            Ok(Response::new(Full::new(Bytes::new())))
        } else {
            error!("CONNECT host is not socket addr: {:?}", req.uri());
            metrics::record_connection_error("invalid_host");

            let mut resp = Response::new(Full::new(Bytes::from(
                "CONNECT must be to a socket address",
            )));
            *resp.status_mut() = StatusCode::BAD_REQUEST;

            // Record latency
            metrics::REQUEST_LATENCY_SECONDS
                .with_label_values(&[&method, "400"])
                .observe(start_time.elapsed().as_secs_f64());

            Ok(resp)
        }
    } else {
        // STANDARD HTTP REQUEST
        metrics::REQUEST_LATENCY_SECONDS
            .with_label_values(&[&method, "501"])
            .observe(start_time.elapsed().as_secs_f64());

        Ok(Response::new(Full::new(Bytes::from(
            "Only CONNECT supported in this minimal checkpoint",
        ))))
    }
}

fn host_addr(uri: &hyper::Uri) -> Option<String> {
    uri.authority().map(|auth| auth.to_string())
}

/// Resolves on SIGTERM (Unix) or Ctrl-C — whichever arrives first.
async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}

/// Helper: Select the best provider based on session and load
async fn select_best_provider(
    state: Arc<AppState>,
    session_id: &str,
    is_sticky: bool,
    authenticator: Arc<SessionAuthenticator>,
    target_geo: Option<&str>,
    target_domain: Option<&str>,
) -> std::io::Result<Option<(yamux::Control, String)>> {
    // Use configured TTL
    let sticky_ttl_secs = state.config.sticky_ttl_secs;

    // W-01: Check rotation state for non-sticky sessions.
    // If the session's rotation policy says it's time to change nodes, we skip
    // the sticky binding and force ML-selected node selection.
    let needs_rotation = if !is_sticky && !session_id.is_empty() {
        let should = state
            .rotation
            .lock()
            .map(|mut mgr| {
                let rot = mgr.get_or_create(session_id);
                let _ = rot.record_request();
                rot.should_rotate()
            })
            .unwrap_or(false);
        should
    } else {
        false
    };

    // 1. Check for existing sticky binding (skipped when rotation is due)
    let sticky_node_id = if is_sticky && !needs_rotation && !session_id.is_empty() {
        match authenticator.get_sticky_node(session_id).await {
            Ok(Some(node_id)) => {
                info!("📌 Sticky session {} bound to node {}", session_id, node_id);
                Some(node_id)
            }
            Ok(None) => {
                info!(
                    "📌 New sticky session {}, will bind on first connection",
                    session_id
                );
                None
            }
            Err(e) => {
                error!("Failed to get sticky binding: {}", e);
                None
            }
        }
    } else {
        if needs_rotation {
            info!("🔄 Rotating session {} — selecting new node", session_id);
        }
        None
    };

    // 2. Select provider
    let selection = if let Some(ref bound_node_id) = sticky_node_id {
        if let Some(control) = state.registry.get_by_id(bound_node_id) {
            info!(
                "📍 Sticky hit: Session {} correctly routed to bound node {}",
                session_id, bound_node_id
            );
            Some((control, bound_node_id.clone()))
        } else {
            warn!("📍 Sticky miss: Bound node {} is unavailable for session {}, selecting best candidate", bound_node_id, session_id);
            state.registry.get_best_for(target_geo, None)
        }
    } else if let Some((control, node_id)) = state.registry.get_best_for(target_geo, None) {
        info!(
            "🧩 Shard-routed to node {} for session {}",
            node_id, session_id
        );
        Some((control, node_id))
    } else if let Some((control, node_id)) = state.select_provider_ml(target_domain) {
        info!(
            "🎯 ML-routed to node {} for session {}",
            node_id, session_id
        );
        Some((control, node_id))
    } else if let Some(control) = state.registry.get_random() {
        info!("🎲 Routed to random node for session {}", session_id);
        Some((control, "random".to_string()))
    } else {
        warn!(
            "🛑 No available nodes found in registry for session {}",
            session_id
        );
        None
    };

    // 3. Bind sticky session if new
    if let Some((_, ref node_id)) = selection {
        if is_sticky && sticky_node_id.is_none() && !session_id.is_empty() {
            if let Err(e) = authenticator
                .set_sticky_node(session_id, node_id, sticky_ttl_secs)
                .await
            {
                error!("Failed to set sticky binding: {}", e);
            } else {
                info!("📌 Bound sticky session {} to node {}", session_id, node_id);
            }
        }
        // W-01: On rotation — assign the new node to the rotation state tracker.
        if needs_rotation {
            if let Ok(mut mgr) = state.rotation.lock() {
                mgr.get_or_create(session_id).assign_node(node_id.clone());
            }
        }
    }

    Ok(selection)
}

/// Helper: Bridge client connection to selected provider
async fn bridge_to_provider(
    upgraded: hyper::upgrade::Upgraded,
    addr: String,
    control: yamux::Control,
    node_id: String,
    state: Arc<AppState>,
    auth_clone: Arc<SessionAuthenticator>,
    username: String,
    session_data: Option<crate::auth::SessionData>,
    bandwidth_cap: u32, // bytes/sec — tier-specific (B-05)
    target_domain: Option<String>,
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

    let circuit_breaker = state
        .circuit_breakers
        .get_breaker(&node_id, circuit_config)
        .await;

    // W-03: Try connection pool first (avoids yamux stream-open RTT on cache hit).
    // If the pool has a pre-opened idle stream we take it; otherwise open fresh.
    let pooled_opt = state
        .connection_pool
        .acquire(&node_id)
        .map(|p| p.take_stream());

    let addr_for_log = addr.clone(); // preserve for post-call logging
                                     // P2-12: connect timeout for yamux stream-open + CONNECT handshake.
    let connect_timeout = std::time::Duration::from_secs(state.config.proxy_connect_timeout_secs);
    match circuit_breaker
        .call(move || {
            let addr = addr.clone();
            let mut control = control.clone();
            async move {
                // P2-12: Bound stream-open so a slow provider doesn't hang indefinitely.
                let mut stream = match pooled_opt {
                    Some(s) => s,
                    None => tokio::time::timeout(connect_timeout, control.open_stream())
                        .await
                        .map_err(|_| {
                            std::io::Error::new(
                                std::io::ErrorKind::TimedOut,
                                "yamux stream open timed out",
                            )
                        })?
                        .map_err(|e| {
                            std::io::Error::new(
                                std::io::ErrorKind::ConnectionRefused,
                                format!("Stream open failed: {}", e),
                            )
                        })?,
                };

                // Send CONNECT command
                let command = format!("CONNECT {}\n", addr);
                stream.write_all(command.as_bytes()).await?;

                // P2-12: Bound CONNECT handshake response read.
                let mut response_buf = [0u8; 64];
                let n = tokio::time::timeout(connect_timeout, stream.read(&mut response_buf))
                    .await
                    .map_err(|_| {
                        std::io::Error::new(
                            std::io::ErrorKind::TimedOut,
                            "provider CONNECT handshake timed out",
                        )
                    })??;

                let response = String::from_utf8_lossy(&response_buf[..n]);
                if !response.starts_with("OK") {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::PermissionDenied,
                        format!("Provider refused: {}", response.trim()),
                    ));
                }

                Ok(stream)
            }
        })
        .await
    {
        Ok(stream) => {
            info!("🔗 Connected to provider {} for {}", node_id, addr_for_log);
            if let Some(ref session) = session_data {
                sync_session_intent_lifecycle(
                    state.clone(),
                    session,
                    "routed",
                    Some(&node_id),
                    target_domain.as_deref(),
                )
                .await;
                sync_session_intent_lifecycle(
                    state.clone(),
                    session,
                    "active",
                    Some(&node_id),
                    target_domain.as_deref(),
                )
                .await;
            }
            // Record success in ML feature cache (P3-W12)
            state
                .feature_cache
                .record_success(&node_id, target_domain.as_deref());

            // Bridge connections
            use tokio_util::compat::FuturesAsyncReadCompatExt;
            let stream = stream.compat();

            // Wrap with tier-aware Traffic Shaper (B-05)
            let mut stream = state
                .shaper
                .wrap_with_cap(stream, username.clone(), bandwidth_cap);

            let mut upgraded = TokioIo::new(upgraded);

            // Bidirectional bridge with bandwidth enforcement (Phase 2: zerocopy module)
            // 64 KB buffers instead of 16 KB → 4× fewer syscalls per MB
            let start = std::time::Instant::now();

            let auth_for_reval = auth_clone.clone();
            let username_for_reval = username.clone();
            let session_for_reval = session_data.clone();
            let state_for_reval = state.clone();
            let node_id_for_reval = node_id.clone();
            let target_host_for_reval = target_domain.clone();
            let last_usage_synced = Arc::new(std::sync::Mutex::new(proxy::zerocopy::BridgeStats::default()));
            let last_usage_synced_for_reval = last_usage_synced.clone();
            let idle_timeout = Some(std::time::Duration::from_secs(
                state.config.proxy_idle_timeout_secs,
            ));
            let stats = proxy::zerocopy::bridge_tracked(
                &mut upgraded,
                &mut stream,
                100 * 1024 * 1024, // revalidate every 100 MB
                idle_timeout,
                move |current_stats| {
                    let auth = auth_for_reval.clone();
                    let u = username_for_reval.clone();
                    let session = session_for_reval.clone();
                    let state = state_for_reval.clone();
                    let node_id = node_id_for_reval.clone();
                    let target_host = target_host_for_reval.clone();
                    let (delta_up, delta_down) = {
                        let mut last = last_usage_synced_for_reval
                            .lock()
                            .expect("usage sync mutex poisoned");
                        let delta_up = current_stats
                            .bytes_from_client
                            .saturating_sub(last.bytes_from_client);
                        let delta_down = current_stats
                            .bytes_from_provider
                            .saturating_sub(last.bytes_from_provider);
                        *last = current_stats;
                        (delta_up, delta_down)
                    };
                    async move {
                        if let Some(session) = session.as_ref() {
                            crate::sync_session_intent_usage(
                                state.clone(),
                                session,
                                Some(&node_id),
                                target_host.as_deref(),
                                delta_up,
                                delta_down,
                            )
                            .await;
                            if crate::auth::revalidate_live_session(&auth, &u, session).await {
                                return true;
                            }
                            if session.is_session_intent() {
                                crate::sync_session_intent_lifecycle(
                                    state,
                                    session,
                                    "closing",
                                    Some(&node_id),
                                    target_host.as_deref(),
                                )
                                .await;
                            }
                        }
                        warn!("🛑 Session {} limit reached. Terminating.", u);
                        false
                    }
                },
            )
            .await;

            let from_client = stats.bytes_from_client;
            let from_provider = stats.bytes_from_provider;

            if let Some(ref session) = session_data {
                let last_synced = *last_usage_synced
                    .lock()
                    .expect("usage sync mutex poisoned");
                crate::finalize_session_intent_ledger(
                    state.clone(),
                    session,
                    Some(&node_id),
                    target_domain.as_deref(),
                    from_client.saturating_sub(last_synced.bytes_from_client),
                    from_provider.saturating_sub(last_synced.bytes_from_provider),
                )
                .await;
            }

            // Report final usage
            let total_bytes = from_client + from_provider;
            if let Err(e) = auth_clone.report_usage(&username, total_bytes as i64).await {
                error!("Failed to report usage: {}", e);
            }

            // Phase 5: ZK-Proof & Solana (Trustless Billing)
            let state_zk = state.clone();
            let session_id = username.clone();
            let up = from_client;
            let down = from_provider;

            if full_decentralization_enabled() {
                info!(
                    session_id = %session_id,
                    "FULL_DECENTRALIZATION enabled: skipping legacy direct edge proof submission"
                );
            } else if !state_zk.config.legacy_edge_zk_submission_enabled {
                info!(
                    session_id = %session_id,
                    "Legacy direct edge proof submission disabled: control-api settlement remains canonical"
                );
            } else if let Some(zk_prover) = state_zk.zk_prover.clone() {
                warn!(
                    session_id = %session_id,
                    "LEGACY_EDGE_ZK_SUBMISSION_ENABLED is on: using deprecated direct edge proof submission path"
                );
                tokio::spawn(async move {
                    let provider_pk = state_zk.solana_relayer.provider_pubkey();
                    if let Some(proof) = zk_prover.prove_usage(&session_id, up, down, &provider_pk).await
                    {
                        let session_hash = {
                            use sha2::{Sha256, Digest};
                            let mut h = Sha256::new();
                            h.update(session_id.as_bytes());
                            let result = h.finalize();
                            let mut out = [0u8; 32];
                            out.copy_from_slice(&result);
                            out
                        };
                        let inputs = crate::billing::zk::PublicInputs {
                            session_id_hash: session_hash,
                            total_bytes_up: up,
                            total_bytes_down: down,
                            provider_pubkey: provider_pk,
                        };
                        if let Err(e) = state_zk.solana_relayer.submit_proof(&proof, &inputs).await
                        {
                            error!("Phase 5: Failed to submit ZK-proof to Solana: {}", e);
                        } else {
                            info!(
                                "Phase 5: ZK-Proof submitted to Solana for session {}",
                                session_id
                            );
                        }
                    }
                });
            } else {
                warn!(
                    session_id = %session_id,
                    "Legacy direct edge proof submission path requested but prover runtime is unavailable"
                );
            }

            info!(
                "✅ Proxy finished: {} up / {} down",
                from_client, from_provider
            );
            Ok((from_client, from_provider))
        }
        Err(CircuitError::Open) => {
            warn!("Circuit breaker open for provider {}", node_id);
            metrics::update_circuit_breaker_state(&node_id, "open");
            metrics::record_circuit_breaker_failure(&node_id);
            state.registry.mark_unhealthy(&node_id);
            // Record domain-level failure (P3-W12)
            state
                .feature_cache
                .record_failure(&node_id, target_domain.as_deref());
            Err(std::io::Error::new(
                std::io::ErrorKind::ConnectionRefused,
                "Circuit breaker open",
            ))
        }
        Err(CircuitError::Timeout) => {
            warn!("Timeout connecting to provider {}", node_id);
            // Record domain-level failure (P3-W12)
            state
                .feature_cache
                .record_failure(&node_id, target_domain.as_deref());
            metrics::update_circuit_breaker_state(&node_id, "open");
            metrics::record_circuit_breaker_failure(&node_id);
            state.registry.mark_unhealthy(&node_id);
            Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "Provider connection timeout",
            ))
        }
        Err(CircuitError::Failure(e)) => {
            error!("Failed to connect to provider {}: {}", node_id, e);
            metrics::record_circuit_breaker_failure(&node_id);
            state.registry.mark_unhealthy(&node_id);
            Err(e)
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Initialize tracing
    tracing_subscriber::fmt::init();

    // Initialize metrics
    metrics::init();

    // Load configuration
    let config = config::Config::from_env();
    if config.legacy_edge_zk_submission_enabled {
        warn!(
            "LEGACY_EDGE_ZK_SUBMISSION_ENABLED is on: deprecated edge-side Groth16/Solana settlement remains enabled"
        );
    } else {
        info!(
            "Legacy edge-side ZK/Solana settlement path disabled; control-api batching remains canonical"
        );
    }
    let addr = config.socket_addr();
    let addr_tunnel = config.tunnel_port;
    let redis_url = config.redis_url.clone();

    // P0-A2: Initialize Redis authenticator with configurable cache
    let authenticator = Arc::new(
        SessionAuthenticator::new(
            &config.redis_url,
            config.session_cache_size,
            config.session_cache_ttl_secs,
        )
        .await?,
    );
    info!(
        "Session cache initialized: size={}, ttl={}s",
        config.session_cache_size, config.session_cache_ttl_secs
    );

    // Initialize Registry Store
    let registry_store = Arc::new(RegistryStore::new(&config.redis_url).await?);

    // Initialize Leader Election
    let service_id = Uuid::new_v4().to_string();
    info!("Starting Edge Gateway with Service ID: {}", service_id);

    // Create a NEW client for leader election
    let redis_client = redis::Client::open(redis_url)?;

    let leader_elector = LeaderElector::new(
        redis_client,
        service_id.clone(),
        "edge-gateway-leader".to_string(),
        30,
    );
    let leader_status = leader_elector.status_flag();

    tokio::spawn(async move {
        leader_elector.run().await;
    });

    // Initialize Helper: Usage Tracker
    let control_api_url =
        std::env::var("CONTROL_API_URL").unwrap_or_else(|_| "http://localhost:8000".to_string());
    let usage_tracker = Arc::new(
        crate::metering::UsageTracker::new(&control_api_url, &config.provider_private_key)
            .expect("Failed to create usage tracker"),
    );
    // Recover any metering data left in the Redis WAL by a previous crashed instance (B-02)
    usage_tracker.recover_from_wal().await;
    usage_tracker.clone().start_flush_task();

    // Pass leader status to state (heartbeat monitor created and owned by AppState)
    let state = Arc::new(AppState::new(
        config,
        leader_status,
        registry_store,
        usage_tracker,
    ));

    // Start heartbeat monitor background task (monitor is owned by state)
    state
        .heartbeat_monitor
        .clone()
        .start_monitoring(state.registry.clone());

    // W-03: Periodic pool prune — evicts stale idle yamux streams every 30s.
    {
        let prune_pool = state.connection_pool.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
            loop {
                interval.tick().await;
                prune_pool.prune_idle();
            }
        });
    }

    // W-04: Leader-gated cluster maintenance — only the elected leader runs these tasks.
    {
        let leader_flag = state.is_leader.clone();
        let leader_registry = state.registry.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
            loop {
                interval.tick().await;
                if leader_flag.load(std::sync::atomic::Ordering::SeqCst) {
                    // Evict nodes that have gone stale (not in the lock-free registry).
                    // The heartbeat monitor marks them unhealthy; here we remove them
                    // from the registry once they've had no heartbeat for a full cycle.
                    let stale: Vec<String> = leader_registry
                        .list_nodes()
                        .into_iter()
                        .filter(|n| !n.is_healthy)
                        .map(|n| n.node_id)
                        .collect();
                    for node_id in stale {
                        leader_registry.remove(&node_id);
                        metrics::record_connection_error("leader_evicted_stale_node");
                        info!("Leader: evicted stale node {}", node_id);
                    }
                }
            }
        });
    }

    // P-06: Score snapshot refresh — rebuilds the pre-sorted candidate list every 100 ms
    // so get_best() is O(1) on the hot path instead of O(n).
    {
        crate::registry::lockfree::LockFreeNodeRegistry::start_score_refresh(
            state.registry.clone(),
            100, // refresh every 100 ms
        );
        info!("Provider score snapshot refresh started (100 ms interval)");
    }

    // P-02: Predictive connection pre-warming — opens idle yamux streams ahead of peak load.
    {
        crate::routing::prewarm::PrewarmEngine::start(
            state.prewarm.clone(),
            state.registry.clone(),
            state.connection_pool.clone(),
        );
        info!("Predictive prewarm engine started");
    }

    // P-05: Multi-region staleness checker — marks regions unhealthy if no heartbeat arrives.
    {
        crate::multiregion::routing::MultiRegionRouter::start_staleness_checker(
            state.multiregion.clone(),
            std::time::Duration::from_secs(120), // region stale after 120 s with no update
        );
        info!("Multi-region staleness checker started");
    }

    let listener = TcpListener::bind(addr).await?;
    info!("Edge Gateway Proxy listening on http://{}", addr);
    info!("Metrics endpoint available at http://{}/metrics", addr);
    info!("Health endpoint available at http://{}/health", addr);

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

                            // Phase 2: auto-builder serves HTTP/1.1 and HTTP/2
                            // (h2c prior-knowledge + ALPN on TLS) from one port.
                            let builder = proxy::http2::make_auto_builder();
                            if let Err(err) = builder
                                .serve_connection_with_upgrades(io, service)
                                .await
                            {
                                error!("Error serving connection: {:?}", err);
                            }
                        });
                    }
                    Err(e) => error!("Accept error: {}", e),
                }
            }
            _ = shutdown_signal() => {
                info!("Shutting down Edge Gateway — draining active tunnels (max 30s)...");
                break;
            }
        }
    }

    // B-09: Drain active tunnels before exiting.
    // Poll ACTIVE_SESSIONS gauge; stop waiting after 30 s regardless.
    let drain_start = std::time::Instant::now();
    let drain_timeout = std::time::Duration::from_secs(30);
    loop {
        let active = metrics::ACTIVE_SESSIONS.get();
        if active == 0 {
            info!("All tunnels drained.");
            break;
        }
        if drain_start.elapsed() >= drain_timeout {
            warn!(
                "Drain timeout — {} tunnel(s) still active, forcing shutdown",
                active
            );
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }

    // Flush metering WAL so no usage records are lost on shutdown.
    info!("Flushing metering WAL before shutdown...");
    state.usage_tracker.flush().await;
    info!("Edge Gateway shutdown complete.");
    Ok(())
}

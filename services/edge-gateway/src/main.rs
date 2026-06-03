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
use tokio::sync::Semaphore;
use tracing::{debug, error, info, trace, warn, Instrument};

mod admission;
mod auth;
mod billing;
#[cfg(feature = "blockchain")]
mod blockchain; // P2-A9: Direct gRPC to Blockchain (optional)
mod circuitbreaker;
mod config;
mod control_api; // Control API client for node registration
mod error; // Error types
mod heartbeat;
mod ingress;
mod internal_forward;
mod leader;
mod metering;
mod metrics;
mod multiregion;
mod net_listen;
mod observability;
mod pod_drain;
mod policy;
mod pool;
#[cfg(feature = "pricing")]
mod pricing; // P2-A10: Real-time Pricing Awareness (optional)
mod proofs;
mod provider_transport;
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

#[cfg(feature = "legacy-zk")]
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
async fn metrics_handler(state: &AppState) -> Result<Response<Full<Bytes>>, hyper::Error> {
    let healthy = state.registry.list_healthy_with_info().len() as i64;
    metrics::refresh_registry_gauges(healthy);
    let metrics_text = metrics::gather_metrics();
    let response = Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "text/plain; version=0.0.4")
        .body(Full::new(Bytes::from(metrics_text)))
        .unwrap();
    Ok(response)
}

/// Health check endpoint — liveness only (process is up).
async fn health_handler(draining: bool) -> Result<Response<Full<Bytes>>, hyper::Error> {
    if draining {
        let body = format!(
            r#"{{"status":"draining","uptime_seconds":{}}}"#,
            metrics::uptime_seconds()
        );
        let response = Response::builder()
            .status(StatusCode::SERVICE_UNAVAILABLE)
            .header("Content-Type", "application/json")
            .body(Full::new(Bytes::from(body)))
            .unwrap();
        return Ok(response);
    }
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

/// Readiness endpoint — gates whether this pod should receive traffic.
///
/// Hard requirement: Redis must answer `PING` (sessions cannot be validated
/// without it, and the gateway fails-closed). Soft signal: healthy provider
/// count is reported and, when `READY_REQUIRE_PROVIDERS=true`, also required
/// (off by default so a freshly-started pod with no providers yet is not stuck
/// un-ready — useful in single-provider/dev stacks).
async fn ready_handler(
    state: &AppState,
    authenticator: &SessionAuthenticator,
) -> Result<Response<Full<Bytes>>, hyper::Error> {
    let draining = pod_drain::is_draining(state);
    let redis_ok = authenticator.ping().await;
    let healthy_providers = state.registry.list_healthy_with_info().len();
    let require_providers = config::ready_requires_providers();
    let providers_ok = !require_providers || healthy_providers > 0;
    let ready = !draining && redis_ok && providers_ok;

    let body = format!(
        r#"{{"status":"{}","draining":{},"redis":{},"healthy_providers":{},"require_providers":{}}}"#,
        if ready { "ready" } else { "not_ready" },
        draining,
        redis_ok,
        healthy_providers,
        require_providers
    );
    let response = Response::builder()
        .status(if ready {
            StatusCode::OK
        } else {
            StatusCode::SERVICE_UNAVAILABLE
        })
        .header("Content-Type", "application/json")
        .body(Full::new(Bytes::from(body)))
        .unwrap();
    Ok(response)
}

async fn run_buyer_accept_loop(
    listener: TcpListener,
    state: Arc<AppState>,
    connection_admission: Arc<Semaphore>,
    authenticator: Arc<SessionAuthenticator>,
    buyer_tls_acceptor: Option<tokio_rustls::TlsAcceptor>,
) {
    loop {
        let (stream, _) = match listener.accept().await {
            Ok(conn) => conn,
            Err(e) => {
                error!("Accept error: {}", e);
                continue;
            }
        };

        if pod_drain::is_draining(&state) {
            metrics::record_connection_error("pod_draining");
            let mut stream = stream;
            admission::write_service_unavailable_and_close(&mut stream).await;
            continue;
        }

        let permit = match connection_admission.clone().try_acquire_owned() {
            Ok(permit) => permit,
            Err(_) => {
                metrics::record_connection_error("admission_rejected");
                let mut stream = stream;
                admission::write_service_unavailable_and_close(&mut stream).await;
                continue;
            }
        };

        let proxy_state = state.clone();
        let auth_clone = authenticator.clone();
        let buyer_tls = buyer_tls_acceptor.clone();

        tokio::task::spawn(async move {
            let _permit = permit;
            if let Some(acceptor) = buyer_tls {
                let tls_fp = crate::security::fingerprint::observe_tls_fingerprints_from_tcp(
                    &stream,
                    &proxy_state.fingerprint_db,
                )
                .await;
                if tls_fp.ja3_digest.is_some() || tls_fp.ja4.is_some() {
                    trace!(
                        ja3 = ?tls_fp.ja3_digest,
                        ja4 = ?tls_fp.ja4,
                        "buyer TLS ClientHello fingerprints"
                    );
                }
                match acceptor.accept(stream).await {
                    Ok(tls_stream) => {
                        serve_buyer_http_connection(
                            TokioIo::new(tls_stream),
                            proxy_state,
                            auth_clone,
                            Some(tls_fp),
                        )
                        .await;
                    }
                    Err(e) => {
                        error!("Buyer TLS handshake failed: {}", e);
                    }
                }
            } else {
                serve_buyer_http_connection(
                    TokioIo::new(stream),
                    proxy_state,
                    auth_clone,
                    None,
                )
                .await;
            }
        });
    }
}

async fn serve_buyer_http_connection<I>(
    io: TokioIo<I>,
    proxy_state: Arc<AppState>,
    auth: Arc<SessionAuthenticator>,
    conn_tls: Option<crate::security::fingerprint::TlsClientFingerprints>,
) where
    I: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let service = service_fn(move |req| {
        let s = proxy_state.clone();
        let a = auth.clone();
        let tls = conn_tls.clone();
        async move { proxy(req, s, a, tls).await }
    });
    let builder = proxy::http2::make_auto_builder();
    if let Err(err) = builder.serve_connection_with_upgrades(io, service).await {
        error!("Error serving connection: {:?}", err);
    }
}

async fn metrics_only_http_connection<I>(io: TokioIo<I>, state: Arc<AppState>)
where
    I: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let service = service_fn(move |req| {
        let s = state.clone();
        async move {
            if req.method() == Method::GET && req.uri().path() == "/metrics" {
                metrics_handler(&s).await
            } else {
                Ok(Response::builder()
                    .status(StatusCode::NOT_FOUND)
                    .body(Full::new(Bytes::from("Not Found")))
                    .unwrap())
            }
        }
    });
    let builder = proxy::http2::make_auto_builder();
    if let Err(err) = builder.serve_connection_with_upgrades(io, service).await {
        error!("Metrics listener connection error: {:?}", err);
    }
}

async fn run_metrics_accept_loop(listener: TcpListener, state: Arc<AppState>) {
    loop {
        let (stream, _) = match listener.accept().await {
            Ok(conn) => conn,
            Err(e) => {
                error!("Metrics accept error: {}", e);
                continue;
            }
        };
        let metrics_state = state.clone();
        tokio::spawn(async move {
            metrics_only_http_connection(TokioIo::new(stream), metrics_state).await;
        });
    }
}

async fn proxy(
    req: Request<hyper::body::Incoming>,
    state: Arc<AppState>,
    authenticator: Arc<SessionAuthenticator>,
    conn_tls: Option<crate::security::fingerprint::TlsClientFingerprints>,
) -> Result<Response<Full<Bytes>>, hyper::Error> {
    let start_time = Instant::now();
    let method = req.method().clone();

    let path = req.uri().path();
    trace!(path, method = %method, "incoming request");

    // Handle metrics endpoint (buyer port only when METRICS_PORT is unset/0)
    if path == "/metrics" && method == Method::GET {
        if state.config.metrics_on_separate_port() {
            return Ok(Response::builder()
                .status(StatusCode::NOT_FOUND)
                .body(Full::new(Bytes::from("Not Found")))
                .unwrap());
        }
        trace!("serving metrics");
        return metrics_handler(&state).await;
    }

    // Handle health endpoint (liveness)
    if path == "/health" && method == Method::GET {
        trace!("serving health");
        return health_handler(pod_drain::is_draining(&state)).await;
    }

    // Handle readiness endpoint (Redis ping + optional provider count)
    if path == "/ready" && method == Method::GET {
        return ready_handler(&state, &authenticator).await;
    }

    // Handle ML stats export endpoint (Debug only)
    if config::debug_routes_enabled() && path == "/debug/ml/stats" && method == Method::GET {
        trace!("serving ML stats export");
        let csv = state.feature_cache.to_csv(&state.registry);
        let mut resp = Response::new(Full::new(Bytes::from(csv)));
        resp.headers_mut().insert(
            hyper::header::CONTENT_TYPE,
            HeaderValue::from_static("text/csv"),
        );
        return Ok(resp);
    }

    if config::pod_drain_admin_enabled() && path == "/admin/drain" && method == Method::POST {
        return Ok(pod_drain::admin_drain_handler(state.clone()).await);
    }

    if config::pod_drain_admin_enabled()
        && path == "/admin/drain/ownership"
        && method == Method::POST
    {
        return Ok(pod_drain::admin_drain_ownership_handler(state.clone()).await);
    }

    if config::debug_routes_enabled() && path == "/debug/directory/stats" && method == Method::GET {
        match pod_drain::directory_stats_json(&state).await {
            Ok(json) => {
                let mut resp = Response::new(Full::new(Bytes::from(json)));
                resp.headers_mut().insert(
                    hyper::header::CONTENT_TYPE,
                    HeaderValue::from_static("application/json"),
                );
                return Ok(resp);
            }
            Err(err) => {
                return Ok(pod_drain::json_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!(r#"{{"error":"{}"}}"#, err.replace('"', "'")),
                ));
            }
        }
    }

    // Handle node list export endpoint (Debug only)
    if config::debug_routes_enabled() && path == "/debug/nodes" && method == Method::GET {
        trace!("serving node list debug");
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
    if config::debug_routes_enabled()
        && path == "/api/v1/network/status"
        && req.method() == Method::GET
    {
        trace!("serving network status API");

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
        let mut country_counts: std::collections::HashMap<String, usize> =
            std::collections::HashMap::new();

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

        let avg_latency = if latency_count > 0 {
            (latency_sum / latency_count) as u32
        } else {
            0
        };

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

        // DDoS rate-limit check (challenge enforced — P2)
        use crate::security::ddos::RateLimitResult;
        const CHALLENGE_RESPONSE: &str = "x-challenge-response";
        const CHALLENGE_TOKEN: &str = "x-challenge-token";

        let challenge_cleared = req
            .headers()
            .get(CHALLENGE_RESPONSE)
            .and_then(|v| v.to_str().ok())
            .map(|t| state.challenge.validate(t))
            .unwrap_or(false);

        match state.ddos.check(ip) {
            RateLimitResult::Block => {
                warn!("🛑 DDoS hard-block for {}", ip);
                state.reputation.ddos_block(ip);
                let mut resp = Response::new(Full::new(Bytes::from("Too Many Requests")));
                *resp.status_mut() = StatusCode::from_u16(429).unwrap_or(StatusCode::FORBIDDEN);
                return Ok(resp);
            }
            RateLimitResult::Challenge if !challenge_cleared => {
                let token = state.challenge.issue();
                warn!(
                    "⚠️ DDoS challenge required for {} (token={})",
                    ip,
                    &token[..8]
                );
                metrics::record_policy_block("ddos_challenge");
                let mut resp = Response::new(Full::new(Bytes::from(
                    "Rate limit challenge: retry with X-Challenge-Response header",
                )));
                *resp.status_mut() =
                    StatusCode::from_u16(429).unwrap_or(StatusCode::TOO_MANY_REQUESTS);
                if let Ok(value) = HeaderValue::from_str(&token) {
                    resp.headers_mut().insert(CHALLENGE_TOKEN, value);
                }
                return Ok(resp);
            }
            RateLimitResult::Challenge | RateLimitResult::Allow => {}
        }
    }

    // P-04: HTTP-layer bot detection (UA, header order, JA3 when buyer TLS is enabled).
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
            ja3: conn_tls.as_ref().and_then(|fp| fp.ja3_digest.clone()),
            h2: None,
            request_interval_ms: 0, // per-request tracking not available at this layer
            header_order_hash,
        };

        let bot_score = BotClassifier::score_with_db(&profile, &state.fingerprint_db);
        if bot_score.is_likely_bot() {
            if let Some(ref digest) = profile.ja3 {
                state.fingerprint_db.observe_ja3(digest, true);
            }
            if let Some(ref ja4) = conn_tls.as_ref().and_then(|fp| fp.ja4.as_ref()) {
                state.fingerprint_db.observe_ja4(ja4, true);
            }
            warn!(
                "🤖 Bot detected (score={:.2}) from {:?} ja3={:?}",
                bot_score.0,
                client_ip,
                profile.ja3
            );
            metrics::record_policy_block("bot_detected");
            let mut resp = Response::new(Full::new(Bytes::from("Forbidden")));
            *resp.status_mut() = StatusCode::FORBIDDEN;
            return Ok(resp);
        }
    }

    // P3b.2: tunnel tier serves providers on TUNNEL_PORT only — reject public buyer proxy on PORT.
    if !state.config.serves_buyer_connect() {
        let is_internal = internal_forward::is_internal_forward_request(&req);
        if proxy::websocket::is_websocket(&req) || (method == Method::CONNECT && !is_internal) {
            metrics::record_policy_block("tunnel_tier_buyer");
            metrics::record_connection_error("tunnel_tier_buyer_rejected");
            warn!(
                path,
                method = %method,
                pod_id = %state.config.edge_pod_id,
                "Rejected buyer proxy on split tunnel tier"
            );
            let mut resp = Response::new(Full::new(Bytes::from(
                "Forbidden: buyer proxy is not served on the tunnel tier; use an ingress pod",
            )));
            *resp.status_mut() = StatusCode::FORBIDDEN;
            metrics::REQUEST_LATENCY_SECONDS
                .with_label_values(&[method.as_str(), "403"])
                .observe(start_time.elapsed().as_secs_f64());
            return Ok(resp);
        }
    }

    // WebSocket upgrade — client tunnels TCP over WS frames (Phase 2)
    if proxy::websocket::is_websocket(&req) {
        debug!(path, "WebSocket upgrade");
        return proxy::websocket::handle_ws_upgrade(req, state, authenticator).await;
    }

    if Method::CONNECT == req.method() {
        if internal_forward::is_internal_forward_request(&req) {
            return internal_forward::handle_internal_forward(req, state, authenticator).await;
        }

        // Record connection started
        metrics::connection_started();

        // Extract and validate authentication
        let auth_header = req.headers().get(PROXY_AUTHORIZATION);
        let credentials = extract_proxy_auth(auth_header);

        // Extract session data for routing decisions
        let (session_username, session_data) = match credentials {
            Some((username, password)) => {
                match authenticator
                    .resolve_proxy_auth(
                        &username,
                        &password,
                        &state.config.session_intent_signing_secret,
                    )
                    .await
                {
                    Ok(Some(resolved)) => {
                        debug!(
                            username = %resolved.username,
                            user_id = %resolved.session.user_id,
                            trust_tier = %resolved.session.trust_tier,
                            session_type = %resolved.session.session_type,
                            "CONNECT authenticated"
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
                            .with_label_values(&[method.as_str(), "407"])
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
                            .with_label_values(&[method.as_str(), "407"])
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
                    .with_label_values(&[method.as_str(), "407"])
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

                let mut resp = Response::new(Full::new(Bytes::from_static(
                    b"Destination blocked by policy",
                )));
                *resp.status_mut() = StatusCode::FORBIDDEN;

                // Record latency
                metrics::REQUEST_LATENCY_SECONDS
                    .with_label_values(&[method.as_str(), "403"])
                    .observe(start_time.elapsed().as_secs_f64());

                return Ok(resp);
            }

            let auth_clone = authenticator.clone();
            let username = session_username.unwrap_or_default();

            // N-02: Session-level domain filter enforcement
            if let Some(ref sd) = session_data {
                // Extract destination host (strip port)
                let dest_host = policy::target_host_from_endpoint(&addr);

                // Blocked-domain check (blacklist wins over whitelist)
                if policy::host_matches_any_domain_rule(dest_host, &sd.blocked_domains) {
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
                        .with_label_values(&[method.as_str(), "403"])
                        .observe(start_time.elapsed().as_secs_f64());
                    return Ok(resp);
                }

                // Allowed-domain whitelist (if non-empty, only listed domains pass)
                if !sd.allowed_domains.is_empty() {
                    let allowed =
                        policy::host_matches_any_domain_rule(dest_host, &sd.allowed_domains);
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
                            .with_label_values(&[method.as_str(), "403"])
                            .observe(start_time.elapsed().as_secs_f64());
                        return Ok(resp);
                    }
                }

                if !sd.session_within_time_limit() {
                    warn!("Session time limit exceeded for {}", username);
                    metrics::record_auth_failure("session_time_limit");

                    let mut resp = Response::new(Full::new(Bytes::from(
                        "Proxy session expired (time limit reached)",
                    )));
                    *resp.status_mut() = StatusCode::PROXY_AUTHENTICATION_REQUIRED;
                    resp.headers_mut().insert(
                        "Proxy-Authenticate",
                        HeaderValue::from_static("Basic realm=\"ProxyHub\""),
                    );
                    metrics::REQUEST_LATENCY_SECONDS
                        .with_label_values(&[method.as_str(), "407"])
                        .observe(start_time.elapsed().as_secs_f64());
                    return Ok(resp);
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
                    .with_label_values(&[method.as_str(), "429"])
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
                let mut resp = Response::new(Full::new(Bytes::from(
                    "Session rate limit exceeded (anomaly)",
                )));
                *resp.status_mut() = StatusCode::TOO_MANY_REQUESTS;
                metrics::REQUEST_LATENCY_SECONDS
                    .with_label_values(&[method.as_str(), "429"])
                    .observe(start_time.elapsed().as_secs_f64());
                return Ok(resp);
            }

            // 3. PRE-FLIGHT: Select provider BEFORE acting on upgrade
            // This allows us to return 503/504 if no providers are available
            let dest_host = policy::target_host_from_endpoint(&addr);
            let target_geo = session_data.as_ref().and_then(|session| {
                if session.target_geo.is_empty() {
                    None
                } else {
                    Some(session.target_geo.as_str())
                }
            });

            // 2.6 Security: Honeytokens (P4-W13)
            if let Some(token_type) = state.honeytoken.check(dest_host) {
                let attributed_provider = crate::registry::provider_selection::attribution_node_id(
                    state.clone(),
                    &session_id,
                    is_sticky,
                    authenticator.clone(),
                    target_geo,
                    Some(dest_host),
                )
                .await;
                let provider_id = attributed_provider
                    .as_deref()
                    .unwrap_or("unknown_provider");
                let attribution_label = if attributed_provider.is_some() {
                    "resolved"
                } else {
                    "unknown"
                };
                warn!(
                    session_id = %session_id,
                    %provider_id,
                    ?token_type,
                    dest = %dest_host,
                    "Honeytoken hit — routing attribution for audit/slash"
                );
                metrics::record_policy_block("honeytoken_hit");
                metrics::record_honeytoken_hit(attribution_label);

                // Phase 8: Trigger On-Chain Slash (requires `legacy-zk` feature)
                #[cfg(feature = "legacy-zk")]
                {
                    let state_cloned = state.clone();
                    let provider_cloned = provider_id.to_string();
                    let token_type_cloned = token_type;
                    tokio::spawn(async move {
                        let _ = state_cloned
                            .solana_relayer
                            .trigger_slash(
                                &provider_cloned,
                                &format!("Honeytoken Hit: {:?}", token_type_cloned),
                                500, // Slash 500 PHUBB tokens
                            )
                            .await;
                    });
                }
                #[cfg(not(feature = "legacy-zk"))]
                warn!(
                    "Honeytoken hit but edge-gateway was built without `legacy-zk`; on-chain slash skipped"
                );

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

            let connect_span =
                observability::buyer_connect_span(&session_id, &addr);
            let provider_route = match async {
                crate::registry::provider_selection::select_provider_route(
                    state.clone(),
                    &session_id,
                    is_sticky,
                    authenticator.clone(),
                    target_geo,
                    Some(dest_host),
                )
                .await
            }
            .instrument(connect_span)
            .await
            {
                Ok(Some(route)) => route,
                Ok(None) => {
                    warn!("No healthy providers available for session {}", session_id);
                    metrics::record_connection_error("no_providers");

                    let mut resp =
                        Response::new(Full::new(Bytes::from("No healthy providers available")));
                    *resp.status_mut() = StatusCode::SERVICE_UNAVAILABLE;

                    metrics::REQUEST_LATENCY_SECONDS
                        .with_label_values(&[method.as_str(), "503"])
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

                    metrics::REQUEST_LATENCY_SECONDS
                        .with_label_values(&[method.as_str(), "500"])
                        .observe(start_time.elapsed().as_secs_f64());

                    return Ok(resp);
                }
            };

            let (provider_control, node_id, peer_forward) = match provider_route {
                crate::registry::provider_selection::ProviderTarget::Local { control, node_id } => {
                    (Some(control), node_id, None)
                }
                crate::registry::provider_selection::ProviderTarget::Remote {
                    node_id,
                    peer_base_url,
                } => {
                    debug!(
                        node_id = %node_id,
                        forward = %peer_base_url,
                        edge_mode = ?state.config.edge_mode,
                        "Routing via owner-pod forward (peer or tunnel tier)"
                    );
                    (None, node_id, Some(peer_base_url))
                }
            };

            // N-01: Enforce provider node-level policy (blocked_ports, allowed_ports,
            // blocked_domains, allowed_domains) fetched from Redis node:config cache.
            {
                let dest_host = policy::target_host_from_endpoint(&addr);
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
                            .with_label_values(&[method.as_str(), "403"])
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
                            .with_label_values(&[method.as_str(), "403"])
                            .observe(start_time.elapsed().as_secs_f64());
                        return Ok(resp);
                    }
                    // Domain: blocked list
                    if policy::host_matches_any_domain_rule(dest_host, &ncfg.blocked_domains) {
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
                            .with_label_values(&[method.as_str(), "403"])
                            .observe(start_time.elapsed().as_secs_f64());
                        return Ok(resp);
                    }
                    // Domain: allowed whitelist
                    if !ncfg.allowed_domains.is_empty() {
                        let ok =
                            policy::host_matches_any_domain_rule(dest_host, &ncfg.allowed_domains);
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
                                .with_label_values(&[method.as_str(), "403"])
                                .observe(start_time.elapsed().as_secs_f64());
                            return Ok(resp);
                        }
                    }
                }
            }

            // 4. Return 200 OK to establish tunnel, then bridge in background
            let session_type_clone = session_type.clone();
            let bridge_session_id = session_id.clone();
            let bridge_span = observability::buyer_connect_bridge_span(
                &bridge_session_id,
                &node_id,
                &addr,
            );
            tokio::task::spawn(
                async move {
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
                        let bridge_result = if let Some(peer_base_url) = peer_forward {
                            internal_forward::bridge_via_peer(
                                upgraded,
                                addr.clone(),
                                node_id.clone(),
                                peer_base_url,
                                tunnel_state.config.gateway_shared_secret.clone(),
                            )
                            .await
                        } else if let Some(control) = provider_control {
                            bridge_to_provider(
                                upgraded,
                                addr,
                                control,
                                node_id.clone(),
                                tunnel_state,
                                auth_clone.clone(),
                                username.clone(),
                                session_data.clone(),
                                bandwidth_cap,
                            )
                            .await
                        } else {
                            Err(std::io::Error::new(
                                std::io::ErrorKind::NotConnected,
                                "No provider route",
                            ))
                        };

                        match bridge_result {
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

                                // Phase 9: ZK Generation & Batch Proof Submission (`legacy-zk` feature)
                                #[cfg(feature = "legacy-zk")]
                                {
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
                                            let provider_pubkey =
                                                state_zk.solana_relayer.provider_pubkey();
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
                                                    use sha2::{Digest, Sha256};
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
            }
                .instrument(bridge_span),
            );

            // Record successful connection latency
            metrics::REQUEST_LATENCY_SECONDS
                .with_label_values(&[method.as_str(), "200"])
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
                .with_label_values(&[method.as_str(), "400"])
                .observe(start_time.elapsed().as_secs_f64());

            Ok(resp)
        }
    } else if !state.config.serves_buyer_connect() {
        metrics::record_policy_block("tunnel_tier_buyer");
        metrics::REQUEST_LATENCY_SECONDS
            .with_label_values(&[method.as_str(), "403"])
            .observe(start_time.elapsed().as_secs_f64());
        let mut resp = Response::new(Full::new(Bytes::from(
            "Forbidden: HTTP proxy not served on tunnel tier",
        )));
        *resp.status_mut() = StatusCode::FORBIDDEN;
        Ok(resp)
    } else {
        // STANDARD HTTP REQUEST
        metrics::REQUEST_LATENCY_SECONDS
            .with_label_values(&[method.as_str(), "501"])
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

/// Bridge client connection to selected provider (local yamux).
pub(crate) async fn bridge_to_provider(
    upgraded: hyper::upgrade::Upgraded,
    addr: String,
    control: yamux::Control,
    node_id: String,
    state: Arc<AppState>,
    auth_clone: Arc<SessionAuthenticator>,
    username: String,
    session_data: Option<crate::auth::SessionData>,
    bandwidth_cap: u32, // bytes/sec — tier-specific (B-05)
) -> std::io::Result<(u64, u64)> {
    let span = observability::provider_bridge_span(&node_id, &addr);
    bridge_to_provider_inner(
        upgraded,
        addr,
        control,
        node_id,
        state,
        auth_clone,
        username,
        session_data,
        bandwidth_cap,
    )
    .instrument(span)
    .await
}

async fn bridge_to_provider_inner(
    upgraded: hyper::upgrade::Upgraded,
    addr: String,
    control: yamux::Control,
    node_id: String,
    state: Arc<AppState>,
    auth_clone: Arc<SessionAuthenticator>,
    username: String,
    session_data: Option<crate::auth::SessionData>,
    bandwidth_cap: u32,
) -> std::io::Result<(u64, u64)> {
    use futures_util::{AsyncReadExt, AsyncWriteExt};

    debug!(node_id = %node_id, target = %addr, "routing CONNECT to provider");

    // 4. Open stream and proxy with circuit breaker protection
    let circuit_config = CircuitConfig::from_env(state.config.proxy_connect_timeout_secs.max(10));

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
    let target_domain = policy::target_host_from_endpoint(&addr_for_log);
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

                // Send CONNECT command (pre-sized — hot path per tunnel)
                let mut command = String::with_capacity(9 + addr.len());
                command.push_str("CONNECT ");
                command.push_str(&addr);
                command.push('\n');
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
            debug!(node_id = %node_id, target = %addr_for_log, "connected to provider");
            if let Some(ref session) = session_data {
                sync_session_intent_lifecycle(
                    state.clone(),
                    session,
                    "routed",
                    Some(&node_id),
                    Some(target_domain),
                )
                .await;
                sync_session_intent_lifecycle(
                    state.clone(),
                    session,
                    "active",
                    Some(&node_id),
                    Some(target_domain),
                )
                .await;
            }
            // Record success in ML feature cache (P3-W12)
            state
                .feature_cache
                .record_success(&node_id, Some(target_domain));

            // Bridge connections
            use tokio_util::compat::FuturesAsyncReadCompatExt;
            let stream = stream.compat();

            // Wrap with tier-aware Traffic Shaper (B-05)
            let mut stream = state
                .shaper
                .wrap_with_cap(stream, username.clone(), bandwidth_cap);

            let client_tcp_fd = proxy::zerocopy::client_tcp_fd_from_upgrade(&upgraded);
            let mut upgraded = TokioIo::new(upgraded);

            // Bidirectional bridge with bandwidth enforcement (Phase 2: zerocopy module)
            // 64 KB buffers instead of 16 KB → 4× fewer syscalls per MB
            let start = std::time::Instant::now();

            let auth_for_reval = auth_clone.clone();
            let username_for_reval = username.clone();
            let session_for_reval = session_data.clone();
            let state_for_reval = state.clone();
            let node_id_for_reval = node_id.clone();
            let target_host_for_reval = target_domain.to_string();
            let last_usage_synced = Arc::new(std::sync::Mutex::new(
                proxy::zerocopy::BridgeStats::default(),
            ));
            let last_usage_synced_for_reval = last_usage_synced.clone();
            let idle_timeout = Some(std::time::Duration::from_secs(
                state.config.proxy_idle_timeout_secs,
            ));
            let stats = proxy::zerocopy::bridge_tracked(
                &mut upgraded,
                &mut stream,
                client_tcp_fd,
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
                                Some(target_host.as_str()),
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
                                    Some(target_host.as_str()),
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
                let last_synced = *last_usage_synced.lock().expect("usage sync mutex poisoned");
                crate::finalize_session_intent_ledger(
                    state.clone(),
                    session,
                    Some(&node_id),
                    Some(target_domain),
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

            // Phase 5: ZK-Proof & Solana (`legacy-zk` feature)
            #[cfg(feature = "legacy-zk")]
            {
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
                        if let Some(proof) = zk_prover
                            .prove_usage(&session_id, up, down, &provider_pk)
                            .await
                        {
                            let session_hash = {
                                use sha2::{Digest, Sha256};
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
                            if let Err(e) =
                                state_zk.solana_relayer.submit_proof(&proof, &inputs).await
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
            }

            debug!(
                node_id = %node_id,
                bytes_up = from_client,
                bytes_down = from_provider,
                "CONNECT tunnel finished"
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
                .record_failure(&node_id, Some(target_domain));
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
                .record_failure(&node_id, Some(target_domain));
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
    observability::init();

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

    let provider_directory = Arc::new(crate::registry::directory::ProviderDirectory::from_manager(
        registry_store.connection_manager(),
        config.edge_pod_id.clone(),
        config.region.clone(),
        config.provider_directory_ttl_secs,
    ));

    match config.provider_transport {
        provider_transport::ProviderTransportKind::Quic => {
            provider_transport::quic::log_transport_status();
        }
        provider_transport::ProviderTransportKind::Yamux => {}
    }
    info!(
        pod_id = %config.edge_pod_id,
        edge_mode = ?config.edge_mode,
        edge_role = ?config.edge_role,
        serves_buyer_connect = config.serves_buyer_connect(),
        binds_tunnel = config.binds_tunnel_listener(),
        tunnel_gw_peers = config.tunnel_gw_urls.len(),
        yamux_conns_per_node = config.yamux_conns_per_node,
        provider_transport = ?config.provider_transport,
        quic_compiled = config.provider_transport.quic_compiled(),
        "Starting Edge Gateway"
    );

    // Initialize Leader Election
    let redis_client = redis::Client::open(redis_url)?;

    let leader_elector = LeaderElector::new(
        redis_client,
        config.edge_pod_id.clone(),
        "edge-gateway-leader".to_string(),
        30,
    );
    let leader_status = leader_elector.status_flag();

    tokio::spawn(async move {
        leader_elector.run().await;
    });

    // Initialize Helper: Usage Tracker
    // Default aligned with Config::from_env (control-api on :8080). Compose/K8s set this
    // explicitly to http://control-api:8080; the default only applies to bare local runs.
    let control_api_url =
        std::env::var("CONTROL_API_URL").unwrap_or_else(|_| "http://localhost:8080".to_string());
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
        provider_directory,
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

    // P-06 / P1: Debounced score snapshot refresh (dirty flag + periodic tick).
    {
        let refresh_ms = state.config.score_snapshot_refresh_ms;
        crate::registry::lockfree::LockFreeNodeRegistry::start_score_refresh(
            state.registry.clone(),
            refresh_ms,
        );
        info!(
            "Provider score snapshot refresh started ({} ms interval, debounced)",
            refresh_ms
        );
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

    let connection_admission = Arc::new(Semaphore::new(state.config.max_concurrent_connections));

    let use_quic_provider_tunnel = {
        #[cfg(feature = "quic")]
        {
            matches!(
                state.config.provider_transport,
                provider_transport::ProviderTransportKind::Quic
            )
        }
        #[cfg(not(feature = "quic"))]
        {
            false
        }
    };

    if state.config.binds_tunnel_listener() {
        if use_quic_provider_tunnel {
            info!(
                port = addr_tunnel,
                "Provider TCP/yamux tunnel disabled (PROVIDER_TRANSPORT=quic)"
            );
        } else {
            let tunnel_state = state.clone();
            tokio::spawn(async move {
                if let Err(e) = tunnel::run_tunnel_server(addr_tunnel, tunnel_state).await {
                    error!("Tunnel server error: {}", e);
                }
            });
            info!("Provider tunnel listening on {}", addr_tunnel);
        }
    } else {
        info!(
            edge_mode = ?state.config.edge_mode,
            edge_role = ?state.config.edge_role,
            "Provider tunnel listener disabled (split ingress tier)"
        );
    }

    #[cfg(feature = "quic")]
    if state.config.binds_tunnel_listener() && use_quic_provider_tunnel {
        let quic_state = state.clone();
        let quic_config = Arc::new(state.config.clone());
        tokio::spawn(async move {
            if let Err(e) =
                provider_transport::quic_listener::spawn_quic_tunnel_listener(quic_config, quic_state)
                    .await
            {
                error!("QUIC tunnel listener error: {}", e);
            }
        });
    }

    if ingress::socks5::enabled() && state.config.serves_buyer_connect() {
        let socks5_addr = ingress::socks5::listen_addr(&state.config.host)?;
        let socks5_state = state.clone();
        let socks5_auth = authenticator.clone();
        tokio::spawn(async move {
            if let Err(e) = ingress::socks5::run_server(socks5_addr, socks5_state, socks5_auth).await
            {
                error!("SOCKS5 ingress error: {}", e);
            }
        });
    } else if ingress::socks5::enabled() {
        info!(
            edge_mode = ?state.config.edge_mode,
            edge_role = ?state.config.edge_role,
            "SOCKS5 ingress disabled on tunnel tier"
        );
    }

    #[cfg(feature = "quic")]
    if ingress::h3::enabled() && state.config.serves_buyer_connect() {
        let h3_addr = ingress::h3::listen_addr(&state.config.host)?;
        let h3_state = state.clone();
        let h3_auth = authenticator.clone();
        tokio::spawn(async move {
            if let Err(e) = ingress::h3::run_server(h3_addr, h3_state, h3_auth).await {
                error!("HTTP/3 ingress error: {}", e);
            }
        });
    }

    let buyer_tls_acceptor = match tls::buyer_tls_config_from_env() {
        Some(cfg) => match tls::create_buyer_tls_acceptor(&cfg) {
            Ok(acceptor) => Some(acceptor),
            Err(e) => {
                return Err(format!("BUYER_TLS_ENABLE set but TLS init failed: {e}").into());
            }
        },
        None => None,
    };

    if let Some(metrics_addr) = state.config.metrics_socket_addr() {
        let metrics_listener = TcpListener::bind(metrics_addr).await?;
        let metrics_state = state.clone();
        tokio::spawn(async move {
            run_metrics_accept_loop(metrics_listener, metrics_state).await;
        });
        info!(
            "Prometheus metrics listening on http://{}/metrics (METRICS_PORT; not on buyer port)",
            metrics_addr
        );
    }

    let listeners = net_listen::bind_buyer_listeners(addr).await?;
    if buyer_tls_acceptor.is_some() {
        info!("Edge Gateway Proxy listening on https://{} (ALPN h2, http/1.1)", addr);
    } else {
        info!("Edge Gateway Proxy listening on http://{}", addr);
    }
    if listeners.len() > 1 {
        info!(
            accept_workers = listeners.len(),
            "Buyer accept pool (SO_REUSEPORT)"
        );
    }
    info!(
        "Buyer connection admission limit: {}",
        state.config.max_concurrent_connections
    );
    let mgmt_scheme = if buyer_tls_acceptor.is_some() {
        "https"
    } else {
        "http"
    };
    if state.config.metrics_on_separate_port() {
        if let Some(metrics_addr) = state.config.metrics_socket_addr() {
            info!(
                "Metrics on buyer port disabled; scrape http://{}/metrics",
                metrics_addr
            );
        }
    } else {
        info!(
            "Metrics endpoint available at {}://{}/metrics",
            mgmt_scheme, addr
        );
    }
    info!(
        "Health endpoint available at {}://{}/health",
        mgmt_scheme, addr
    );

    let mut accept_tasks = Vec::new();
    for listener in listeners {
        accept_tasks.push(tokio::spawn(run_buyer_accept_loop(
            listener,
            state.clone(),
            connection_admission.clone(),
            authenticator.clone(),
            buyer_tls_acceptor.clone(),
        )));
    }

    shutdown_signal().await;
    info!("Shutting down Edge Gateway — draining active tunnels (max 30s)...");
    pod_drain::set_draining(&state, true);
    for task in accept_tasks {
        task.abort();
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

    if state.config.edge_mode.uses_multipod_directory() {
        match state.provider_directory.release_all_owned().await {
            Ok(released) => info!(
                released,
                pod_id = %state.config.edge_pod_id,
                "Released provider directory keys after drain"
            ),
            Err(err) => warn!(
                error = %err,
                "Failed to release provider directory on shutdown"
            ),
        }
    }

    // Flush metering WAL so no usage records are lost on shutdown.
    info!("Flushing metering WAL before shutdown...");
    state.usage_tracker.flush().await;
    info!("Edge Gateway shutdown complete.");
    Ok(())
}

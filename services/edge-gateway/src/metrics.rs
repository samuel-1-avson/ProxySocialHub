//! Prometheus metrics export for Edge Gateway
//!
//! Exposes metrics at /metrics endpoint for Prometheus scraping

use lazy_static::lazy_static;
use prometheus::{
    register_counter_vec, register_gauge_vec, register_histogram_vec, register_int_counter,
    register_int_gauge, CounterVec, Encoder, GaugeVec, HistogramVec, IntCounter, IntGauge,
    TextEncoder,
};
use std::time::Instant;

lazy_static! {
    // Connection metrics
    pub static ref ACTIVE_CONNECTIONS: IntGauge = register_int_gauge!(
        "edge_gateway_active_connections",
        "Number of currently active proxy connections"
    )
    .unwrap();

    pub static ref TOTAL_CONNECTIONS: IntCounter = register_int_counter!(
        "edge_gateway_total_connections",
        "Total number of proxy connections handled"
    )
    .unwrap();

    pub static ref CONNECTION_ERRORS: CounterVec = register_counter_vec!(
        "edge_gateway_connection_errors",
        "Connection errors by type",
        &["error_type"]
    )
    .unwrap();

    // Bandwidth metrics
    pub static ref BANDWIDTH_BYTES_TOTAL: CounterVec = register_counter_vec!(
        "edge_gateway_bandwidth_bytes_total",
        "Total bandwidth transferred",
        &["direction"]
    )
    .unwrap();

    pub static ref BANDWIDTH_RATE: GaugeVec = register_gauge_vec!(
        "edge_gateway_bandwidth_rate_bytes_per_second",
        "Current bandwidth rate",
        &["direction"]
    )
    .unwrap();

    // Session metrics
    pub static ref ACTIVE_SESSIONS: IntGauge = register_int_gauge!(
        "edge_gateway_active_sessions",
        "Number of active sessions"
    )
    .unwrap();

    pub static ref SESSION_DURATION_SECONDS: HistogramVec = register_histogram_vec!(
        "edge_gateway_session_duration_seconds",
        "Session duration distribution",
        &["session_type"],
        vec![0.1, 0.5, 1.0, 5.0, 10.0, 30.0, 60.0, 300.0, 600.0, 1800.0, 3600.0]
    )
    .unwrap();

    pub static ref SESSION_AUTH_FAILURES: CounterVec = register_counter_vec!(
        "edge_gateway_session_auth_failures",
        "Session authentication failures",
        &["reason"]
    )
    .unwrap();

    // Provider/Node metrics — S-10: node_id removed to prevent high-cardinality label explosion.
    // Per-node analytics live in PostgreSQL wallet_ledger_entries / usage_records.
    pub static ref PROVIDER_HEALTH_SCORE: GaugeVec = register_gauge_vec!(
        "edge_gateway_provider_health_score",
        "Health score of provider nodes aggregated by country (0-100)",
        &["country"]
    )
    .unwrap();

    pub static ref PROVIDER_ACTIVE_CONNECTIONS: IntGauge = register_int_gauge!(
        "edge_gateway_provider_active_connections",
        "Total active connections across all providers"
    )
    .unwrap();

    pub static ref PROVIDER_TOTAL_BYTES: CounterVec = register_counter_vec!(
        "edge_gateway_provider_total_bytes",
        "Total bytes served by direction",
        &["direction"]
    )
    .unwrap();

    pub static ref PROVIDER_LATENCY_MS: GaugeVec = register_gauge_vec!(
        "edge_gateway_provider_latency_ms",
        "Latency to provider nodes aggregated by country",
        &["country"]
    )
    .unwrap();

    // Circuit breaker metrics — S-10: track aggregate state counts, not per-node series.
    pub static ref CIRCUIT_BREAKER_STATE: GaugeVec = register_gauge_vec!(
        "edge_gateway_circuit_breaker_open_count",
        "Number of circuit breakers in each state",
        &["state"]
    )
    .unwrap();

    pub static ref CIRCUIT_BREAKER_FAILURES: IntCounter = register_int_counter!(
        "edge_gateway_circuit_breaker_failures_total",
        "Total circuit breaker failures across all providers"
    )
    .unwrap();

    // Rate limiting metrics
    pub static ref RATE_LIMIT_HITS: CounterVec = register_counter_vec!(
        "edge_gateway_rate_limit_hits",
        "Rate limit hits by limit type",
        &["limit_type"]
    )
    .unwrap();

    // Request latency
    pub static ref REQUEST_LATENCY_SECONDS: HistogramVec = register_histogram_vec!(
        "edge_gateway_request_latency_seconds",
        "Request latency distribution",
        &["method", "status"],
        vec![0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0]
    )
    .unwrap();

    // Geographic metrics
    pub static ref CONNECTIONS_BY_COUNTRY: CounterVec = register_counter_vec!(
        "edge_gateway_connections_by_country",
        "Connections by country code",
        &["country_code"]
    )
    .unwrap();

    // Policy enforcement
    pub static ref POLICY_BLOCKS: CounterVec = register_counter_vec!(
        "edge_gateway_policy_blocks",
        "Policy enforcement blocks",
        &["reason"]
    )
    .unwrap();

    /// P5: honeytoken hits with whether a provider node id was resolved for attribution.
    pub static ref HONEYTOKEN_HITS: CounterVec = register_counter_vec!(
        "edge_gateway_honeytoken_hits_total",
        "Honeytoken decoy access attempts",
        &["attribution"]
    )
    .unwrap();

    // P0-A2: Session cache metrics
    pub static ref SESSION_CACHE_HITS: IntCounter = register_int_counter!(
        "edge_gateway_session_cache_hits_total",
        "Total session cache hits"
    )
    .unwrap();

    pub static ref SESSION_CACHE_MISSES: IntCounter = register_int_counter!(
        "edge_gateway_session_cache_misses_total",
        "Total session cache misses"
    )
    .unwrap();

    pub static ref SESSION_CACHE_SIZE: IntGauge = register_int_gauge!(
        "edge_gateway_session_cache_size",
        "Current number of entries in session cache"
    )
    .unwrap();

    pub static ref SESSION_CACHE_EVICTIONS: IntCounter = register_int_counter!(
        "edge_gateway_session_cache_evictions_total",
        "Total session cache evictions"
    )
    .unwrap();

    /// P3: local yamux vs peer forward vs no route (low cardinality).
    pub static ref PROVIDER_ROUTE_SELECTION: CounterVec = register_counter_vec!(
        "edge_gateway_provider_route_selection_total",
        "Provider route resolution outcomes",
        &["route"]
    )
    .unwrap();

    /// P5: healthy providers with local yamux control (refreshed on each /metrics scrape).
    pub static ref HEALTHY_PROVIDERS: IntGauge = register_int_gauge!(
        "edge_gateway_healthy_providers",
        "Healthy provider nodes registered on this pod (local control handles)"
    )
    .unwrap();
}

/// Start time for uptime calculation
static START_TIME: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();

/// Initialize metrics system
pub fn init() {
    START_TIME.get_or_init(Instant::now);

    // prometheus 0.13 only exports lazy_static metrics after first use — register all at boot
    // so /metrics and Grafana RED panels work before the first CONNECT or provider route.
    let _ = ACTIVE_CONNECTIONS.get();
    let _ = TOTAL_CONNECTIONS.get();
    let _ = ACTIVE_SESSIONS.get();
    let _ = PROVIDER_ACTIVE_CONNECTIONS.get();
    let _ = CIRCUIT_BREAKER_FAILURES.get();
    let _ = SESSION_CACHE_HITS.get();
    let _ = SESSION_CACHE_MISSES.get();
    let _ = SESSION_CACHE_SIZE.get();
    let _ = SESSION_CACHE_EVICTIONS.get();
    HEALTHY_PROVIDERS.set(0);

    CONNECTION_ERRORS.with_label_values(&["init"]);
    BANDWIDTH_BYTES_TOTAL.with_label_values(&["up"]);
    BANDWIDTH_BYTES_TOTAL.with_label_values(&["down"]);
    BANDWIDTH_RATE.with_label_values(&["up"]);
    SESSION_DURATION_SECONDS.with_label_values(&["unknown"]);
    SESSION_AUTH_FAILURES.with_label_values(&["init"]);
    PROVIDER_HEALTH_SCORE.with_label_values(&["unknown"]);
    PROVIDER_TOTAL_BYTES.with_label_values(&["up"]);
    PROVIDER_LATENCY_MS.with_label_values(&["unknown"]);
    CIRCUIT_BREAKER_STATE.with_label_values(&["closed"]);
    RATE_LIMIT_HITS.with_label_values(&["init"]);
    REQUEST_LATENCY_SECONDS.with_label_values(&["INIT", "0"]);
    CONNECTIONS_BY_COUNTRY.with_label_values(&["unknown"]);
    POLICY_BLOCKS.with_label_values(&["init"]);
    HONEYTOKEN_HITS.with_label_values(&["resolved"]);
    HONEYTOKEN_HITS.with_label_values(&["unknown"]);
    PROVIDER_ROUTE_SELECTION.with_label_values(&["local"]);
    PROVIDER_ROUTE_SELECTION.with_label_values(&["remote"]);
    PROVIDER_ROUTE_SELECTION.with_label_values(&["tunnel_remote"]);
    PROVIDER_ROUTE_SELECTION.with_label_values(&["miss"]);

    tracing::info!("Prometheus metrics initialized");
}

/// Update gauges that require registry state (call before `gather_metrics`).
pub fn refresh_registry_gauges(healthy_provider_count: i64) {
    HEALTHY_PROVIDERS.set(healthy_provider_count);
}

/// Get metrics in Prometheus text format
pub fn gather_metrics() -> String {
    let encoder = TextEncoder::new();
    let metric_families = prometheus::gather();
    let mut buffer = Vec::new();

    if let Err(e) = encoder.encode(&metric_families, &mut buffer) {
        tracing::error!("Failed to encode metrics: {}", e);
        return String::new();
    }

    String::from_utf8(buffer).unwrap_or_default()
}

/// Update connection metrics
pub fn connection_started() {
    ACTIVE_CONNECTIONS.inc();
    TOTAL_CONNECTIONS.inc();
}

pub fn connection_ended(bytes_up: u64, bytes_down: u64) {
    ACTIVE_CONNECTIONS.dec();
    record_bandwidth(bytes_up, bytes_down);
}

pub fn record_bandwidth(bytes_up: u64, bytes_down: u64) {
    if bytes_up > 0 {
        BANDWIDTH_BYTES_TOTAL
            .with_label_values(&["up"])
            .inc_by(bytes_up as f64);
    }

    if bytes_down > 0 {
        BANDWIDTH_BYTES_TOTAL
            .with_label_values(&["down"])
            .inc_by(bytes_down as f64);
    }
}

/// Record connection error
pub fn record_connection_error(error_type: &str) {
    CONNECTION_ERRORS.with_label_values(&[error_type]).inc();
}

/// Update provider metrics (S-10: aggregated by country, node_id dropped)
pub fn update_provider_metrics(
    _node_id: &str,
    country: &str,
    health_score: f64,
    _active_conns: u32,
    latency_ms: u32,
) {
    PROVIDER_HEALTH_SCORE
        .with_label_values(&[country])
        .set(health_score);

    PROVIDER_LATENCY_MS
        .with_label_values(&[country])
        .set(latency_ms as f64);
}

/// Record provider bandwidth
pub fn record_provider_bandwidth(_node_id: &str, bytes_up: u64, bytes_down: u64) {
    if bytes_up > 0 {
        PROVIDER_TOTAL_BYTES
            .with_label_values(&["up"])
            .inc_by(bytes_up as f64);
    }

    if bytes_down > 0 {
        PROVIDER_TOTAL_BYTES
            .with_label_values(&["down"])
            .inc_by(bytes_down as f64);
    }
}

/// Update circuit breaker state aggregate (S-10: tracks counts by state, not per node)
pub fn update_circuit_breaker_state(_node_id: &str, state: &str) {
    // Increment the counter for the new state. For "open" we track transitions.
    // This gives aggregate observability without per-node cardinality.
    if state == "open" {
        CIRCUIT_BREAKER_STATE.with_label_values(&["open"]).inc();
    } else if state == "closed" || state == "half-open" {
        // Decrement open count when recovering (floor at 0)
        let current = CIRCUIT_BREAKER_STATE.with_label_values(&["open"]).get();
        if current > 0.0 {
            CIRCUIT_BREAKER_STATE.with_label_values(&["open"]).dec();
        }
    }
}

/// Record circuit breaker failure (S-10: aggregate total, no per-node label)
pub fn record_circuit_breaker_failure(_node_id: &str) {
    CIRCUIT_BREAKER_FAILURES.inc();
}

/// Record rate limit hit
pub fn record_rate_limit_hit(limit_type: &str) {
    RATE_LIMIT_HITS.with_label_values(&[limit_type]).inc();
}

/// Record policy block
pub fn record_policy_block(reason: &str) {
    POLICY_BLOCKS.with_label_values(&[reason]).inc();
}

/// Record honeytoken hit (`attribution` is `resolved` or `unknown`).
pub fn record_honeytoken_hit(attribution: &str) {
    HONEYTOKEN_HITS.with_label_values(&[attribution]).inc();
}

/// Record session authentication failure
pub fn record_auth_failure(reason: &str) {
    SESSION_AUTH_FAILURES.with_label_values(&[reason]).inc();
}

/// Record session duration
pub fn record_session_duration(session_type: &str, duration_secs: f64) {
    SESSION_DURATION_SECONDS
        .with_label_values(&[session_type])
        .observe(duration_secs);
}

/// Record geographic connection
pub fn record_connection_by_country(country_code: &str) {
    CONNECTIONS_BY_COUNTRY
        .with_label_values(&[country_code])
        .inc();
}

/// Get uptime in seconds
pub fn uptime_seconds() -> u64 {
    START_TIME.get().map(|t| t.elapsed().as_secs()).unwrap_or(0)
}

/// P0-A2: Record session cache hit
pub fn record_session_cache_hit() {
    SESSION_CACHE_HITS.inc();
}

/// P0-A2: Record session cache miss
pub fn record_session_cache_miss() {
    SESSION_CACHE_MISSES.inc();
}

/// P0-A2: Update session cache size gauge
pub fn set_session_cache_size(size: i64) {
    SESSION_CACHE_SIZE.set(size);
}

/// P0-A2: Record session cache eviction
pub fn record_session_cache_eviction() {
    SESSION_CACHE_EVICTIONS.inc();
}

/// P3: `route` is `local`, `remote`, `tunnel_remote` (split ingress→tunnel), or `miss`.
pub fn record_provider_route(route: &str) {
    PROVIDER_ROUTE_SELECTION.with_label_values(&[route]).inc();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_metrics_initialization() {
        init();
        let metrics = gather_metrics();
        assert!(!metrics.is_empty());
        assert!(metrics.contains("edge_gateway_active_connections"));
    }

    #[test]
    fn test_connection_metrics() {
        let initial = ACTIVE_CONNECTIONS.get();
        connection_started();
        assert_eq!(ACTIVE_CONNECTIONS.get(), initial + 1);

        connection_ended(1000, 2000);
        assert_eq!(ACTIVE_CONNECTIONS.get(), initial);
    }

    #[test]
    fn test_provider_metrics() {
        update_provider_metrics("node-1", "GH", 95.0, 10, 50);

        let metrics = gather_metrics();
        assert!(metrics.contains("edge_gateway_provider_health_score"));
        assert!(metrics.contains("GH"));
    }
}

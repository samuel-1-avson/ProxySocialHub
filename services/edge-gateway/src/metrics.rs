// Prometheus metrics for Edge Gateway

use lazy_static::lazy_static;
use prometheus::{
    register_counter, register_counter_vec, register_gauge, register_gauge_vec, register_histogram,
    register_histogram_vec, register_int_counter, register_int_gauge, Counter, CounterVec, Encoder,
    Gauge, GaugeVec, Histogram, HistogramVec, IntCounter, IntCounterVec, IntGauge, IntGaugeVec,
    Opts, Registry, TextEncoder,
};
use std::sync::Arc;

lazy_static! {
    // Connection metrics
    pub static ref ACTIVE_CONNECTIONS: IntGauge = register_int_gauge!(
        "edge_gateway_active_connections",
        "Number of active proxy connections"
    ).expect("Failed to register active_connections metric");

    pub static ref TOTAL_CONNECTIONS: IntCounter = register_int_counter!(
        "edge_gateway_total_connections",
        "Total number of proxy connections handled"
    ).expect("Failed to register active_connections metric");

    pub static ref CONNECTION_ERRORS: IntCounterVec = register_int_counter_vec!(
        "edge_gateway_connection_errors_total",
        "Total number of connection errors",
        &["error_type"]
    ).expect("Failed to register active_connections metric");

    // Provider metrics
    pub static ref CONNECTED_PROVIDERS: IntGauge = register_int_gauge!(
        "edge_gateway_connected_providers",
        "Number of connected provider nodes"
    ).expect("Failed to register active_connections metric");

    pub static ref PROVIDER_SELECTIONS: IntCounterVec = register_int_counter_vec!(
        "edge_gateway_provider_selections_total",
        "Total provider selections by strategy",
        &["strategy", "country"]
    ).expect("Failed to register active_connections metric");

    // Bandwidth metrics
    pub static ref BYTES_RECEIVED: IntCounter = register_int_counter!(
        "edge_gateway_bytes_received_total",
        "Total bytes received from clients"
    ).expect("Failed to register active_connections metric");

    pub static ref BYTES_SENT: IntCounter = register_int_counter!(
        "edge_gateway_bytes_sent_total",
        "Total bytes sent to clients"
    ).expect("Failed to register active_connections metric");

    pub static ref BYTES_TO_PROVIDERS: IntCounter = register_int_counter!(
        "edge_gateway_bytes_to_providers_total",
        "Total bytes sent to providers"
    ).expect("Failed to register active_connections metric");

    // Request metrics
    pub static ref REQUEST_DURATION: HistogramVec = register_histogram_vec!(
        "edge_gateway_request_duration_seconds",
        "Request duration in seconds",
        &["status"],
        vec![0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0]
    ).expect("Failed to register active_connections metric");

    pub static ref REQUESTS_BY_STATUS: IntCounterVec = register_int_counter_vec!(
        "edge_gateway_requests_total",
        "Total requests by status code",
        &["status"]
    ).expect("Failed to register active_connections metric");

    // Authentication metrics
    pub static ref AUTH_ATTEMPTS: IntCounterVec = register_int_counter_vec!(
        "edge_gateway_auth_attempts_total",
        "Total authentication attempts",
        &["result"]  // success, failed, expired
    ).expect("Failed to register active_connections metric");

    pub static ref SESSION_CACHE_HITS: IntCounter = register_int_counter!(
        "edge_gateway_session_cache_hits",
        "Number of session cache hits"
    ).expect("Failed to register active_connections metric");

    pub static ref SESSION_CACHE_MISSES: IntCounter = register_int_counter!(
        "edge_gateway_session_cache_misses",
        "Number of session cache misses"
    ).expect("Failed to register active_connections metric");

    // Rate limiting metrics
    pub static ref RATE_LIMITED_REQUESTS: IntCounter = register_int_counter!(
        "edge_gateway_rate_limited_requests",
        "Number of rate-limited requests"
    ).expect("Failed to register active_connections metric");

    // Policy metrics
    pub static ref POLICY_BLOCKS: IntCounterVec = register_int_counter_vec!(
        "edge_gateway_policy_blocks_total",
        "Total requests blocked by policy",
        &["reason"]  // port, private_ip, banned_domain
    ).expect("Failed to register active_connections metric");

    // Rotation metrics
    pub static ref ROTATIONS: IntCounterVec = register_int_counter_vec!(
        "edge_gateway_ip_rotations_total",
        "Total IP rotations",
        &["strategy", "reason"]  // time, request_count, error
    ).expect("Failed to register active_connections metric");

    // Health metrics
    pub static ref PROVIDER_HEALTH_CHECKS: IntCounterVec = register_int_counter_vec!(
        "edge_gateway_provider_health_checks_total",
        "Total provider health checks",
        &["result"]  // healthy, unhealthy
    ).expect("Failed to register active_connections metric");

    pub static ref PROVIDER_LATENCY: HistogramVec = register_histogram_vec!(
        "edge_gateway_provider_latency_ms",
        "Provider latency in milliseconds",
        &["provider_id"],
        vec![1.0, 5.0, 10.0, 25.0, 50.0, 100.0, 250.0, 500.0, 1000.0]
    ).expect("Failed to register active_connections metric");
}

/// Record metric helpers
pub mod record {
    use super::*;

    pub fn connection_opened() {
        ACTIVE_CONNECTIONS.inc();
        TOTAL_CONNECTIONS.inc();
    }

    pub fn connection_closed() {
        ACTIVE_CONNECTIONS.dec();
    }

    pub fn connection_error(error_type: &str) {
        CONNECTION_ERRORS.with_label_values(&[error_type]).inc();
    }

    pub fn provider_connected() {
        CONNECTED_PROVIDERS.inc();
    }

    pub fn provider_disconnected() {
        CONNECTED_PROVIDERS.dec();
    }

    pub fn provider_selected(strategy: &str, country: &str) {
        PROVIDER_SELECTIONS
            .with_label_values(&[strategy, country])
            .inc();
    }

    pub fn bytes_transferred(received: u64, sent: u64) {
        BYTES_RECEIVED.inc_by(received);
        BYTES_SENT.inc_by(sent);
    }

    pub fn request_completed(status: &str, duration_secs: f64) {
        REQUESTS_BY_STATUS.with_label_values(&[status]).inc();
        REQUEST_DURATION
            .with_label_values(&[status])
            .observe(duration_secs);
    }

    pub fn auth_attempt(result: &str) {
        AUTH_ATTEMPTS.with_label_values(&[result]).inc();
    }

    pub fn cache_hit() {
        SESSION_CACHE_HITS.inc();
    }

    pub fn cache_miss() {
        SESSION_CACHE_MISSES.inc();
    }

    pub fn rate_limited() {
        RATE_LIMITED_REQUESTS.inc();
    }

    pub fn policy_block(reason: &str) {
        POLICY_BLOCKS.with_label_values(&[reason]).inc();
    }

    pub fn ip_rotation(strategy: &str, reason: &str) {
        ROTATIONS.with_label_values(&[strategy, reason]).inc();
    }

    pub fn health_check(healthy: bool) {
        let result = if healthy { "healthy" } else { "unhealthy" };
        PROVIDER_HEALTH_CHECKS.with_label_values(&[result]).inc();
    }

    pub fn provider_latency(provider_id: &str, latency_ms: f64) {
        PROVIDER_LATENCY
            .with_label_values(&[provider_id])
            .observe(latency_ms);
    }
}

/// Generate metrics text output
pub fn metrics_output() -> String {
    let encoder = TextEncoder::new();
    let metric_families = prometheus::gather();
    let mut buffer = Vec::new();
    if let Err(e) = encoder.encode(&metric_families, &mut buffer) {
        eprintln!("Failed to encode metrics: {}", e);
        return String::new();
    }
    String::from_utf8(buffer).unwrap_or_else(|e| {
        eprintln!("Failed to convert metrics to UTF-8: {}", e);
        String::new()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_metrics_initialization() {
        // Test that metrics can be accessed without panic
        record::connection_opened();
        record::connection_closed();
        record::auth_attempt("success");
        record::bytes_transferred(100, 200);

        let output = metrics_output();
        assert!(output.contains("edge_gateway"));
    }
}

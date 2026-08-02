//! Rolling-window routing analytics + Prometheus export (P3-W11).
//!
//! Records every `RoutingDecision` in a lock-protected ring buffer (last 1 000
//! decisions) and exports Prometheus gauges for:
//!
//! - `routing_p50_latency_ms`   — median selection latency
//! - `routing_p99_latency_ms`   — 99th-percentile selection latency
//! - `routing_ml_accuracy`      — ML-variant success rate
//! - `routing_heuristic_accuracy` — heuristic-variant success rate
//! - `routing_ml_fraction`      — configured ML traffic fraction

use std::sync::Mutex;
use std::time::Instant;

use lazy_static::lazy_static;
use prometheus::{Gauge, Registry};
use tracing::warn;

// ---------------------------------------------------------------------------
// RoutingDecision — a single routing event record
// ---------------------------------------------------------------------------

/// A single routing decision captured for analytics.
#[derive(Debug, Clone)]
pub struct RoutingDecision {
    /// Backend used: "heuristic" or "onnx".
    pub backend: &'static str,
    /// Whether the connection that followed was successful.
    pub success: bool,
    /// Time taken to score and select a node (microseconds).
    pub selection_us: u64,
    /// The node_id selected.
    pub node_id: String,
}

// ---------------------------------------------------------------------------
// RollingWindow — ring-buffer of last N decisions
// ---------------------------------------------------------------------------

const WINDOW_SIZE: usize = 1000;

struct RollingWindow {
    buf: Vec<RoutingDecision>,
    head: usize,
    len: usize,
}

impl RollingWindow {
    fn new() -> Self {
        Self {
            buf: Vec::with_capacity(WINDOW_SIZE),
            head: 0,
            len: 0,
        }
    }

    fn push(&mut self, d: RoutingDecision) {
        if self.len < WINDOW_SIZE {
            self.buf.push(d);
            self.len += 1;
        } else {
            self.buf[self.head] = d;
            self.head = (self.head + 1) % WINDOW_SIZE;
        }
    }

    fn iter(&self) -> impl Iterator<Item = &RoutingDecision> {
        self.buf.iter()
    }
}

// ---------------------------------------------------------------------------
// Prometheus metrics
// ---------------------------------------------------------------------------

lazy_static! {
    static ref P50_LATENCY: Gauge = Gauge::new(
        "routing_p50_latency_us",
        "Median provider-selection latency (μs)"
    )
    .unwrap();
    static ref P99_LATENCY: Gauge = Gauge::new(
        "routing_p99_latency_us",
        "99th-percentile provider-selection latency (μs)"
    )
    .unwrap();
    static ref ML_ACCURACY: Gauge =
        Gauge::new("routing_ml_accuracy", "ML backend connection success rate").unwrap();
    static ref HEURISTIC_ACCURACY: Gauge = Gauge::new(
        "routing_heuristic_accuracy",
        "Heuristic backend connection success rate"
    )
    .unwrap();
    static ref ML_FRACTION_GAUGE: Gauge = Gauge::new(
        "routing_ml_fraction",
        "Fraction of traffic sent to ML backend"
    )
    .unwrap();
}

/// Register all routing gauges into a Prometheus `Registry`.
pub fn register_metrics(registry: &Registry) {
    let collectors: Vec<Box<dyn prometheus::core::Collector>> = vec![
        Box::new(P50_LATENCY.clone()),
        Box::new(P99_LATENCY.clone()),
        Box::new(ML_ACCURACY.clone()),
        Box::new(HEURISTIC_ACCURACY.clone()),
        Box::new(ML_FRACTION_GAUGE.clone()),
    ];
    for collector in collectors {
        if let Err(e) = registry.register(collector) {
            warn!("routing metrics register: {}", e);
        }
    }
}

// ---------------------------------------------------------------------------
// RoutingAnalytics — public API
// ---------------------------------------------------------------------------

pub struct RoutingAnalytics {
    window: Mutex<RollingWindow>,
    ml_fraction: f64,
}

impl RoutingAnalytics {
    pub fn new(ml_fraction: f64) -> Self {
        ML_FRACTION_GAUGE.set(ml_fraction);
        Self {
            window: Mutex::new(RollingWindow::new()),
            ml_fraction,
        }
    }

    /// Record a routing decision and refresh Prometheus gauges.
    pub fn record(&self, decision: RoutingDecision) {
        let mut w = self.window.lock().unwrap();
        w.push(decision);
        self.export_gauges(&w);
    }

    /// Convenience: start a timer, returning an `Instant` to pass to [`record_with_timer`].
    pub fn start_timer() -> Instant {
        Instant::now()
    }

    /// Build a `RoutingDecision` from a timer started by [`start_timer`].
    pub fn finish(
        start: Instant,
        backend: &'static str,
        node_id: String,
        success: bool,
    ) -> RoutingDecision {
        RoutingDecision {
            backend,
            success,
            selection_us: start.elapsed().as_micros() as u64,
            node_id,
        }
    }

    // ------------------------------------------------------------------
    // Internal helpers
    // ------------------------------------------------------------------

    fn export_gauges(&self, w: &RollingWindow) {
        let mut latencies: Vec<u64> = w.iter().map(|d| d.selection_us).collect();
        if !latencies.is_empty() {
            latencies.sort_unstable();
            let p50 = percentile(&latencies, 50);
            let p99 = percentile(&latencies, 99);
            P50_LATENCY.set(p50 as f64);
            P99_LATENCY.set(p99 as f64);
        }

        let (ml_s, ml_t, h_s, h_t) = w.iter().fold((0u64, 0u64, 0u64, 0u64), |acc, d| {
            if d.backend == "onnx" {
                (acc.0 + d.success as u64, acc.1 + 1, acc.2, acc.3)
            } else {
                (acc.0, acc.1, acc.2 + d.success as u64, acc.3 + 1)
            }
        });

        if ml_t > 0 {
            ML_ACCURACY.set(ml_s as f64 / ml_t as f64);
        }
        if h_t > 0 {
            HEURISTIC_ACCURACY.set(h_s as f64 / h_t as f64);
        }
    }

    /// Return a point-in-time snapshot of analytics metrics.
    pub fn snapshot(&self) -> AnalyticsSnapshot {
        let w = self.window.lock().unwrap();
        let mut latencies: Vec<u64> = w.iter().map(|d| d.selection_us).collect();
        latencies.sort_unstable();

        let (ml_s, ml_t, h_s, h_t) = w.iter().fold((0u64, 0u64, 0u64, 0u64), |acc, d| {
            if d.backend == "onnx" {
                (acc.0 + d.success as u64, acc.1 + 1, acc.2, acc.3)
            } else {
                (acc.0, acc.1, acc.2 + d.success as u64, acc.3 + 1)
            }
        });

        AnalyticsSnapshot {
            total_decisions: latencies.len(),
            p50_latency_us: if latencies.is_empty() {
                0
            } else {
                percentile(&latencies, 50)
            },
            p99_latency_us: if latencies.is_empty() {
                0
            } else {
                percentile(&latencies, 99)
            },
            ml_accuracy: if ml_t > 0 {
                ml_s as f64 / ml_t as f64
            } else {
                0.0
            },
            heuristic_accuracy: if h_t > 0 {
                h_s as f64 / h_t as f64
            } else {
                0.0
            },
            ml_fraction: self.ml_fraction,
        }
    }
}

/// Point-in-time analytics snapshot.
#[derive(Debug, Clone)]
pub struct AnalyticsSnapshot {
    pub total_decisions: usize,
    pub p50_latency_us: u64,
    pub p99_latency_us: u64,
    pub ml_accuracy: f64,
    pub heuristic_accuracy: f64,
    pub ml_fraction: f64,
}

fn percentile(sorted: &[u64], p: usize) -> u64 {
    if sorted.is_empty() {
        return 0;
    }
    // Nearest-rank on the (len-1) scale: floor keeps p50 of an even-length
    // window at the lower median element (p50 of 1..=100 → 50).
    let idx = ((p as f64 / 100.0) * (sorted.len() - 1) as f64).floor() as usize;
    sorted[idx.min(sorted.len() - 1)]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn decision(backend: &'static str, success: bool, us: u64) -> RoutingDecision {
        RoutingDecision {
            backend,
            success,
            selection_us: us,
            node_id: "n1".into(),
        }
    }

    #[test]
    fn test_percentile_empty() {
        assert_eq!(percentile(&[], 50), 0);
    }

    #[test]
    fn test_percentile_single() {
        assert_eq!(percentile(&[42], 99), 42);
    }

    #[test]
    fn test_percentile_range() {
        let v: Vec<u64> = (1..=100).collect();
        assert_eq!(percentile(&v, 50), 50);
        assert_eq!(percentile(&v, 99), 99);
    }

    #[test]
    fn test_rolling_window_overflow() {
        let analytics = RoutingAnalytics::new(0.0);
        for i in 0..(WINDOW_SIZE + 50) {
            analytics.record(decision("heuristic", true, i as u64));
        }
        let snap = analytics.snapshot();
        assert_eq!(snap.total_decisions, WINDOW_SIZE);
    }

    #[test]
    fn test_snapshot_accuracy() {
        let analytics = RoutingAnalytics::new(0.5);
        analytics.record(decision("heuristic", true, 10));
        analytics.record(decision("heuristic", false, 10));
        analytics.record(decision("onnx", true, 10));
        let snap = analytics.snapshot();
        assert!((snap.heuristic_accuracy - 0.5).abs() < 1e-6);
        assert!((snap.ml_accuracy - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_snapshot_latency_percentiles() {
        let analytics = RoutingAnalytics::new(0.0);
        for us in [10u64, 20, 30, 40, 50, 60, 70, 80, 90, 100] {
            analytics.record(decision("heuristic", true, us));
        }
        let snap = analytics.snapshot();
        assert!(snap.p50_latency_us > 0);
        assert!(snap.p99_latency_us >= snap.p50_latency_us);
    }
}

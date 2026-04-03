//! A/B test coordinator for ML vs heuristic routing (P3-W10).
//!
//! Routes a configurable fraction of requests to the ML (ONNX) backend and
//! the remainder to the heuristic backend.  Tracks per-variant outcomes so
//! statistical significance can be evaluated offline.
//!
//! # Usage
//! ```ignore
//! let ab = AbTestCoordinator::new(0.10); // 10% ML traffic
//! let backend = ab.choose_backend();      // "onnx" or "heuristic"
//! // … perform routing …
//! ab.record_outcome(backend, success);
//! ```

use std::sync::atomic::{AtomicU64, Ordering};

use rand::Rng;
use tracing::debug;

// ---------------------------------------------------------------------------
// VariantStats — per-variant success/failure counters
// ---------------------------------------------------------------------------

#[derive(Default, Debug)]
pub struct VariantStats {
    pub success: AtomicU64,
    pub failure: AtomicU64,
}

impl VariantStats {
    pub fn record(&self, success: bool) {
        if success {
            self.success.fetch_add(1, Ordering::Relaxed);
        } else {
            self.failure.fetch_add(1, Ordering::Relaxed);
        }
    }

    pub fn total(&self) -> u64 {
        self.success.load(Ordering::Relaxed) + self.failure.load(Ordering::Relaxed)
    }

    pub fn success_rate(&self) -> f64 {
        let s = self.success.load(Ordering::Relaxed) as f64;
        let t = self.total() as f64;
        if t == 0.0 {
            0.0
        } else {
            s / t
        }
    }
}

// ---------------------------------------------------------------------------
// AbTestCoordinator
// ---------------------------------------------------------------------------

/// Coordinator that splits traffic between two routing backends.
pub struct AbTestCoordinator {
    /// Fraction of requests routed to the ML backend (0.0 = disabled, 1.0 = all ML).
    ml_fraction: f64,
    pub heuristic_stats: VariantStats,
    pub ml_stats: VariantStats,
}

impl AbTestCoordinator {
    /// Create a new coordinator.  `ml_fraction` must be in [0.0, 1.0].
    pub fn new(ml_fraction: f64) -> Self {
        let ml_fraction = ml_fraction.clamp(0.0, 1.0);
        Self {
            ml_fraction,
            heuristic_stats: VariantStats::default(),
            ml_stats: VariantStats::default(),
        }
    }

    /// Choose a backend name for this request.
    ///
    /// Returns `"onnx"` with probability `ml_fraction`, otherwise `"heuristic"`.
    pub fn choose_backend(&self) -> &'static str {
        if self.ml_fraction == 0.0 {
            return "heuristic";
        }
        let roll: f64 = rand::thread_rng().gen();
        let backend = if roll < self.ml_fraction {
            "onnx"
        } else {
            "heuristic"
        };
        debug!("A/B: roll={:.4} → {}", roll, backend);
        backend
    }

    /// Record the outcome of a routing decision for `backend`.
    pub fn record_outcome(&self, backend: &str, success: bool) {
        match backend {
            "onnx" => self.ml_stats.record(success),
            _ => self.heuristic_stats.record(success),
        }
    }

    /// Return a snapshot of current stats for both variants.
    pub fn snapshot(&self) -> AbTestSnapshot {
        AbTestSnapshot {
            ml_fraction: self.ml_fraction,
            heuristic_success_rate: self.heuristic_stats.success_rate(),
            heuristic_total: self.heuristic_stats.total(),
            ml_success_rate: self.ml_stats.success_rate(),
            ml_total: self.ml_stats.total(),
        }
    }

    /// Crude statistical significance: returns `true` when each variant has
    /// enough samples to compare.  Threshold: ≥ 1000 observations each.
    pub fn is_significant(&self) -> bool {
        self.heuristic_stats.total() >= 1000 && self.ml_stats.total() >= 1000
    }
}

/// Point-in-time snapshot of A/B test metrics.
#[derive(Debug, Clone)]
pub struct AbTestSnapshot {
    pub ml_fraction: f64,
    pub heuristic_success_rate: f64,
    pub heuristic_total: u64,
    pub ml_success_rate: f64,
    pub ml_total: u64,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_zero_ml_fraction_always_heuristic() {
        let ab = AbTestCoordinator::new(0.0);
        for _ in 0..100 {
            assert_eq!(ab.choose_backend(), "heuristic");
        }
    }

    #[test]
    fn test_full_ml_fraction_always_onnx() {
        let ab = AbTestCoordinator::new(1.0);
        for _ in 0..100 {
            assert_eq!(ab.choose_backend(), "onnx");
        }
    }

    #[test]
    fn test_record_outcome() {
        let ab = AbTestCoordinator::new(0.5);
        ab.record_outcome("heuristic", true);
        ab.record_outcome("heuristic", false);
        ab.record_outcome("onnx", true);

        assert_eq!(ab.heuristic_stats.total(), 2);
        assert!((ab.heuristic_stats.success_rate() - 0.5).abs() < 1e-6);
        assert_eq!(ab.ml_stats.total(), 1);
        assert_eq!(ab.ml_stats.success_rate(), 1.0);
    }

    #[test]
    fn test_significance_threshold() {
        let ab = AbTestCoordinator::new(0.5);
        assert!(!ab.is_significant());

        for _ in 0..1000 {
            ab.heuristic_stats.record(true);
            ab.ml_stats.record(true);
        }
        assert!(ab.is_significant());
    }

    #[test]
    fn test_fraction_clamped() {
        let ab_low = AbTestCoordinator::new(-1.0);
        assert_eq!(ab_low.ml_fraction, 0.0);
        let ab_high = AbTestCoordinator::new(2.0);
        assert_eq!(ab_high.ml_fraction, 1.0);
    }
}

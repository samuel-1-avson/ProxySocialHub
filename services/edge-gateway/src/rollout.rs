//! Staged rollout controller (P4-W16).
//!
//! Implements a deterministic traffic splitter for gradual feature roll-outs
//! following the pattern: **Canary (5%) → Partial (25%) → Full (100%)**.
//!
//! # Bucketing
//! Each session/request is hashed with FNV-1a into bucket [0, 99].  If
//! `bucket < stage.percentage`, the request is in the "new" cohort.
//! The hash is deterministic: the same session always goes to the same cohort.
//!
//! # Usage
//! ```ignore
//! let rollout = RolloutController::new();
//! rollout.advance(RolloutStage::Canary);   // 5% rollout
//!
//! // In request handler:
//! if rollout.is_enabled("session-xyz") {
//!     // serve new code path
//! } else {
//!     // serve stable code path
//! }
//!
//! // After validating metrics, advance:
//! rollout.advance(RolloutStage::Partial);  // 25%
//! rollout.advance(RolloutStage::Full);     // 100%
//! ```

use std::sync::atomic::{AtomicU8, Ordering};

use tracing::info;

// ---------------------------------------------------------------------------
// RolloutStage
// ---------------------------------------------------------------------------

/// Predefined rollout stages.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum RolloutStage {
    /// 0% — all traffic on stable path.
    Disabled,
    /// 5% — early-adopter canary cohort.
    Canary,
    /// 25% — quarter rollout after canary validation.
    Partial,
    /// 100% — full production rollout.
    Full,
}

impl RolloutStage {
    /// Traffic percentage in new cohort (0–100).
    pub fn percentage(self) -> u8 {
        match self {
            RolloutStage::Disabled => 0,
            RolloutStage::Canary => 5,
            RolloutStage::Partial => 25,
            RolloutStage::Full => 100,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            RolloutStage::Disabled => "disabled",
            RolloutStage::Canary => "canary(5%)",
            RolloutStage::Partial => "partial(25%)",
            RolloutStage::Full => "full(100%)",
        }
    }
}

// ---------------------------------------------------------------------------
// RolloutController
// ---------------------------------------------------------------------------

/// Thread-safe rollout state machine.
pub struct RolloutController {
    /// Current stage percentage stored atomically.
    percentage: AtomicU8,
}

impl RolloutController {
    pub fn new() -> Self {
        Self {
            percentage: AtomicU8::new(0),
        }
    }

    /// Advance to `stage`.  Rolls back are allowed (e.g. Partial → Canary on bad metrics).
    pub fn advance(&self, stage: RolloutStage) {
        let pct = stage.percentage();
        self.percentage.store(pct, Ordering::Relaxed);
        info!("🚀 Rollout advanced to {} ({}%)", stage.name(), pct);
    }

    /// Set an arbitrary percentage [0, 100].
    pub fn set_percentage(&self, pct: u8) {
        let pct = pct.min(100);
        self.percentage.store(pct, Ordering::Relaxed);
        info!("🚀 Rollout set to {}%", pct);
    }

    /// Returns `true` if `key` falls in the new-code cohort.
    ///
    /// `key` can be a session ID, user ID, or IP address string — anything
    /// that is stable across the lifetime of a session.
    pub fn is_enabled(&self, key: &str) -> bool {
        let pct = self.percentage.load(Ordering::Relaxed);
        if pct == 0 {
            return false;
        }
        if pct == 100 {
            return true;
        }
        fnv_bucket(key) < pct
    }

    pub fn current_percentage(&self) -> u8 {
        self.percentage.load(Ordering::Relaxed)
    }

    /// Derive the `RolloutStage` closest to the current percentage.
    pub fn current_stage(&self) -> RolloutStage {
        match self.current_percentage() {
            0 => RolloutStage::Disabled,
            1..=5 => RolloutStage::Canary,
            6..=25 => RolloutStage::Partial,
            _ => RolloutStage::Full,
        }
    }
}

impl Default for RolloutController {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Bucketing helper
// ---------------------------------------------------------------------------

/// FNV-1a 32-bit hash of `key`, mapped to [0, 99].
fn fnv_bucket(key: &str) -> u8 {
    let mut h: u32 = 0x811c9dc5;
    for b in key.bytes() {
        h ^= b as u32;
        h = h.wrapping_mul(0x01000193);
    }
    (h % 100) as u8
}

// ---------------------------------------------------------------------------
// Staged rollout plan — helper to walk through stages with validation
// ---------------------------------------------------------------------------

/// Minimum sample size before allowing auto-advance.
pub const MIN_SAMPLE_SIZE: u64 = 500;

/// A plan that can be advanced through stages with built-in safety checks.
pub struct RolloutPlan {
    pub controller: RolloutController,
    /// Requests served at current stage.
    pub stage_requests: std::sync::atomic::AtomicU64,
    /// Errors at current stage.
    pub stage_errors: std::sync::atomic::AtomicU64,
}

impl RolloutPlan {
    pub fn new() -> Self {
        Self {
            controller: RolloutController::new(),
            stage_requests: std::sync::atomic::AtomicU64::new(0),
            stage_errors: std::sync::atomic::AtomicU64::new(0),
        }
    }

    pub fn record(&self, error: bool) {
        self.stage_requests.fetch_add(1, Ordering::Relaxed);
        if error {
            self.stage_errors.fetch_add(1, Ordering::Relaxed);
        }
    }

    /// Try to advance to `next_stage`.
    ///
    /// Returns `Ok(())` if advanced, `Err(reason)` if safety check failed.
    pub fn try_advance(&self, next_stage: RolloutStage) -> Result<(), String> {
        let requests = self.stage_requests.load(Ordering::Relaxed);
        let errors = self.stage_errors.load(Ordering::Relaxed);

        if requests < MIN_SAMPLE_SIZE {
            return Err(format!(
                "insufficient sample: {} < {} required",
                requests, MIN_SAMPLE_SIZE
            ));
        }

        let error_rate = if requests > 0 {
            errors as f64 / requests as f64
        } else {
            0.0
        };
        if error_rate > 0.01 {
            return Err(format!(
                "error rate too high: {:.2}% > 1.0% threshold",
                error_rate * 100.0
            ));
        }

        self.controller.advance(next_stage);
        // Reset counters for the next stage
        self.stage_requests.store(0, Ordering::Relaxed);
        self.stage_errors.store(0, Ordering::Relaxed);
        Ok(())
    }
}

impl Default for RolloutPlan {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_disabled_always_false() {
        let r = RolloutController::new();
        for key in &["a", "b", "test-session", "12345"] {
            assert!(!r.is_enabled(key));
        }
    }

    #[test]
    fn test_full_always_true() {
        let r = RolloutController::new();
        r.advance(RolloutStage::Full);
        for key in &["a", "b", "test-session"] {
            assert!(r.is_enabled(key));
        }
    }

    #[test]
    fn test_canary_approx_5_percent() {
        let r = RolloutController::new();
        r.advance(RolloutStage::Canary);

        let n = 10_000u32;
        let enabled = (0..n)
            .filter(|i| r.is_enabled(&format!("session-{}", i)))
            .count();
        // Allow ±3% around 5%
        let pct = enabled as f64 / n as f64 * 100.0;
        assert!(pct > 2.0 && pct < 8.0, "canary pct={:.1}", pct);
    }

    #[test]
    fn test_deterministic_bucketing() {
        let r = RolloutController::new();
        r.advance(RolloutStage::Partial);
        let v1 = r.is_enabled("stable-key");
        let v2 = r.is_enabled("stable-key");
        assert_eq!(v1, v2);
    }

    #[test]
    fn test_rollback_advance() {
        let r = RolloutController::new();
        r.advance(RolloutStage::Full);
        assert_eq!(r.current_percentage(), 100);
        r.advance(RolloutStage::Canary);
        assert_eq!(r.current_percentage(), 5);
    }

    #[test]
    fn test_current_stage_mapping() {
        let r = RolloutController::new();
        r.set_percentage(0);
        assert_eq!(r.current_stage(), RolloutStage::Disabled);
        r.set_percentage(5);
        assert_eq!(r.current_stage(), RolloutStage::Canary);
        r.set_percentage(25);
        assert_eq!(r.current_stage(), RolloutStage::Partial);
        r.set_percentage(100);
        assert_eq!(r.current_stage(), RolloutStage::Full);
    }

    #[test]
    fn test_rollout_plan_insufficient_sample() {
        let plan = RolloutPlan::new();
        plan.controller.advance(RolloutStage::Canary);
        plan.record(false);
        let result = plan.try_advance(RolloutStage::Partial);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("insufficient sample"));
    }

    #[test]
    fn test_rollout_plan_high_error_rate() {
        let plan = RolloutPlan::new();
        plan.controller.advance(RolloutStage::Canary);
        for _ in 0..MIN_SAMPLE_SIZE {
            plan.record(true); // all errors
        }
        let result = plan.try_advance(RolloutStage::Partial);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("error rate"));
    }

    #[test]
    fn test_rollout_plan_successful_advance() {
        let plan = RolloutPlan::new();
        plan.controller.advance(RolloutStage::Canary);
        for _ in 0..MIN_SAMPLE_SIZE {
            plan.record(false); // all successes
        }
        assert!(plan.try_advance(RolloutStage::Partial).is_ok());
        assert_eq!(plan.controller.current_stage(), RolloutStage::Partial);
        // Counters reset
        assert_eq!(plan.stage_requests.load(Ordering::Relaxed), 0);
    }
}

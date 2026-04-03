//! P2-A10: Demand Tracker
//!
//! Tracks network utilization and calculates demand-based pricing multipliers.
//! Uses exponential moving average for smooth transitions.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

/// Demand tracker for dynamic pricing
pub struct DemandTracker {
    /// Current utilization percentage (0-100, stored as atomic u64 for thread safety)
    /// Actually stores percent * 100 for 2 decimal precision
    current_utilization: AtomicU64,

    /// Smoothing factor for EMA (0.0 - 1.0, higher = more responsive)
    smoothing: f64,

    /// Minimum multiplier (at 0% utilization)
    min_multiplier: f64,

    /// Maximum multiplier (at 100% utilization)
    max_multiplier: f64,
}

impl DemandTracker {
    /// Create a new demand tracker
    pub fn new() -> Self {
        Self {
            current_utilization: AtomicU64::new(0),
            smoothing: 0.3,      // 30% smoothing
            min_multiplier: 0.5, // 50% of base price at low demand
            max_multiplier: 3.0, // 300% of base price at high demand
        }
    }

    /// Update utilization with new measurement
    pub async fn update(&self, utilization_percent: f64) {
        let clamped = utilization_percent.clamp(0.0, 100.0);
        let scaled = (clamped * 100.0) as u64; // Store as hundredths

        // Update with exponential moving average
        let current = self.current_utilization.load(Ordering::Relaxed);
        let current_f64 = current as f64 / 100.0;

        let smoothed = current_f64 + self.smoothing * (clamped - current_f64);
        let new_scaled = (smoothed * 100.0) as u64;

        self.current_utilization
            .store(new_scaled, Ordering::Relaxed);

        tracing::debug!(
            raw = utilization_percent,
            smoothed = smoothed,
            multiplier = self.calculate_multiplier(smoothed),
            "Demand updated"
        );
    }

    /// Get current demand multiplier
    pub async fn get_multiplier(&self) -> f64 {
        let utilization = self.current_utilization.load(Ordering::Relaxed) as f64 / 100.0;
        self.calculate_multiplier(utilization)
    }

    /// Calculate multiplier from utilization percentage
    fn calculate_multiplier(&self, utilization: f64) -> f64 {
        // Linear interpolation between min and max
        let normalized = utilization / 100.0;
        let multiplier =
            self.min_multiplier + (self.max_multiplier - self.min_multiplier) * normalized;

        multiplier.clamp(self.min_multiplier, self.max_multiplier)
    }

    /// Get current utilization percentage
    pub async fn utilization(&self) -> f64 {
        self.current_utilization.load(Ordering::Relaxed) as f64 / 100.0
    }

    /// Set smoothing factor
    pub fn set_smoothing(&mut self, factor: f64) {
        self.smoothing = factor.clamp(0.0, 1.0);
    }

    /// Set multiplier range
    pub fn set_multiplier_range(&mut self, min: f64, max: f64) {
        self.min_multiplier = min.max(0.1);
        self.max_multiplier = max.max(min);
    }
}

impl Default for DemandTracker {
    fn default() -> Self {
        Self::new()
    }
}

/// Demand-based pricing curve presets
pub mod presets {
    /// Conservative pricing (less volatility)
    pub fn conservative() -> super::DemandTracker {
        let mut tracker = super::DemandTracker::new();
        tracker.set_smoothing(0.1);
        tracker.set_multiplier_range(0.8, 2.0);
        tracker
    }

    /// Aggressive pricing (more volatility, higher peaks)
    pub fn aggressive() -> super::DemandTracker {
        let mut tracker = super::DemandTracker::new();
        tracker.set_smoothing(0.5);
        tracker.set_multiplier_range(0.3, 5.0);
        tracker
    }

    /// Flat pricing (no demand adjustment)
    pub fn flat() -> super::DemandTracker {
        let mut tracker = super::DemandTracker::new();
        tracker.set_multiplier_range(1.0, 1.0);
        tracker
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_multiplier_calculation() {
        let tracker = DemandTracker::new();

        // At 0% utilization, should be min_multiplier
        assert!((tracker.calculate_multiplier(0.0) - 0.5).abs() < 0.01);

        // At 50% utilization, should be midpoint
        let mid = tracker.calculate_multiplier(50.0);
        assert!(mid > 0.5 && mid < 3.0);

        // At 100% utilization, should be max_multiplier
        assert!((tracker.calculate_multiplier(100.0) - 3.0).abs() < 0.01);
    }

    #[tokio::test]
    async fn test_update_and_read() {
        let tracker = DemandTracker::new();

        tracker.update(50.0).await;

        let util = tracker.utilization().await;
        assert!(util > 0.0 && util <= 50.0); // Should be smoothed

        let mult = tracker.get_multiplier().await;
        assert!(mult >= 0.5 && mult <= 3.0);
    }
}

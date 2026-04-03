//! Anomaly Detection — monitors per-session request patterns and connection signals.
//!
//! Naive scrapers and botnets often exhibit distinct rhythmic or high-frequency
//! patterns that differ from human-driven proxy usage.

use dashmap::DashMap;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

#[derive(Debug, Default)]
struct SessionMetrics {
    /// Number of requests in the current sliding window.
    pub request_count: AtomicU32,
    /// Total bytes transferred in the current session.
    pub total_bytes: AtomicU64,
    /// Unix timestamp of the last request.
    pub last_request_time: AtomicU64,
    /// Average interval between requests (ms).
    pub avg_interval_ms: AtomicU32,
}

pub struct AnomalyTracker {
    /// Map of session_id (username or token) to its live metrics.
    sessions: DashMap<String, Arc<SessionMetrics>>,
    /// Threshold for "bursty" behavior (requests per minute).
    max_rpm: u32,
}

impl AnomalyTracker {
    pub fn new(max_rpm: u32) -> Self {
        Self {
            sessions: DashMap::new(),
            max_rpm,
        }
    }

    /// Update metrics for a session and return true if an anomaly is detected.
    pub fn record_request(&self, session_id: &str) -> bool {
        let metrics = self
            .sessions
            .entry(session_id.to_string())
            .or_insert_with(|| Arc::new(SessionMetrics::default()))
            .clone();

        let count = metrics.request_count.fetch_add(1, Ordering::Relaxed);

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or(Duration::ZERO)
            .as_secs();

        let last = metrics.last_request_time.swap(now, Ordering::Relaxed);

        if last > 0 {
            let interval = now.saturating_sub(last) as u32;
            let prev_avg = metrics.avg_interval_ms.load(Ordering::Relaxed);
            // EWMA for intervals (alpha = 0.2)
            let new_avg = (prev_avg * 4 + interval * 1000) / 5;
            metrics.avg_interval_ms.store(new_avg, Ordering::Relaxed);
        }

        // Simple anomaly check: requests per minute (RPM)
        // Reset count if > 1 minute since last update
        if now.saturating_sub(last) > 60 {
            metrics.request_count.store(1, Ordering::Relaxed);
            return false;
        }

        count > self.max_rpm
    }

    /// Record data transfer and return true if ratio is suspicious.
    pub fn record_bytes(&self, session_id: &str, bytes: u64) -> bool {
        if let Some(metrics) = self.sessions.get(session_id) {
            let total = metrics.total_bytes.fetch_add(bytes, Ordering::Relaxed);
            // Flag session if > 1GB in a short period (naive threshold)
            return total > (1024 * 1024 * 1024);
        }
        false
    }
}

impl Default for AnomalyTracker {
    fn default() -> Self {
        Self::new(300) // Default 300 requests per minute
    }
}

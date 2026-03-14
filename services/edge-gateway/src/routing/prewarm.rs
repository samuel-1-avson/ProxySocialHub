//! Predictive connection pre-warming (P3-W11).
//!
//! Observes hourly connection-count patterns per node and proactively opens
//! yamux streams before the expected peak to eliminate cold-start latency.
//!
//! # Algorithm
//! 1. `HourlyPattern` maintains a 24-entry ring of `AtomicU32` connection counts.
//! 2. Each time a connection is established the current-hour bucket increments.
//! 3. The `PrewarmEngine` background task runs every `check_interval` (default 60 s).
//! 4. For each node it computes `predicted_next_hour = count[next_hour]`.
//! 5. If `predicted_next_hour > current_idle_streams + PREWARM_HEADROOM`, it opens
//!    additional idle streams via yamux Control and deposits them in the pool.

use std::sync::{
    atomic::{AtomicU32, Ordering},
    Arc,
};
use std::time::Duration;

use dashmap::DashMap;
use tracing::{debug, info, warn};

use crate::pool::ConnectionPool;
use crate::registry::lockfree::LockFreeNodeRegistry;

// ---------------------------------------------------------------------------
// HourlyPattern
// ---------------------------------------------------------------------------

/// Circular buffer tracking connection counts for each of the 24 hours.
pub struct HourlyPattern {
    /// counts[h] = number of connections started during hour `h` (0-23).
    counts: [AtomicU32; 24],
}

impl HourlyPattern {
    pub fn new() -> Self {
        Self {
            counts: std::array::from_fn(|_| AtomicU32::new(0)),
        }
    }

    /// Increment the bucket for `hour` (0–23).
    pub fn record(&self, hour: u8) {
        if hour < 24 {
            self.counts[hour as usize].fetch_add(1, Ordering::Relaxed);
        }
    }

    /// Return the raw count for `hour`.
    pub fn get(&self, hour: u8) -> u32 {
        if hour < 24 {
            self.counts[hour as usize].load(Ordering::Relaxed)
        } else {
            0
        }
    }

    /// Predict the number of connections for `next_hour` based on current data.
    pub fn predict(&self, next_hour: u8) -> u32 {
        self.get(next_hour % 24)
    }
}

impl Default for HourlyPattern {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// PrewarmEngine
// ---------------------------------------------------------------------------

/// Minimum number of idle streams above the prediction to open proactively.
const PREWARM_HEADROOM: u32 = 2;

/// Drives predictive pre-warming of yamux connection pools.
pub struct PrewarmEngine {
    patterns: DashMap<String, Arc<HourlyPattern>>,
    check_interval: Duration,
}

impl PrewarmEngine {
    pub fn new(check_interval: Duration) -> Self {
        Self {
            patterns: DashMap::new(),
            check_interval,
        }
    }

    /// Get (or lazily create) the `HourlyPattern` for `node_id`.
    pub fn pattern(&self, node_id: &str) -> Arc<HourlyPattern> {
        self.patterns
            .entry(node_id.to_string())
            .or_insert_with(|| Arc::new(HourlyPattern::new()))
            .clone()
    }

    /// Record a new connection for `node_id` at `hour`.
    pub fn record_connection(&self, node_id: &str, hour: u8) {
        self.pattern(node_id).record(hour);
    }

    /// Start the background prewarm task.
    ///
    /// The task loops indefinitely; cancel by dropping the returned `JoinHandle`.
    pub fn start(
        engine: Arc<Self>,
        registry: Arc<LockFreeNodeRegistry>,
        pool: Arc<ConnectionPool>,
    ) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(engine.check_interval).await;
                engine.run_once(&registry, &pool).await;
            }
        })
    }

    /// Single prewarm pass: for every registered healthy node, compute the
    /// predicted next-hour demand and open streams if below threshold.
    async fn run_once(&self, registry: &LockFreeNodeRegistry, pool: &Arc<ConnectionPool>) {
        let next_hour = {
            let secs = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            ((secs / 3600 + 1) % 24) as u8
        };

        let nodes = registry.list_healthy_with_info();
        for (node_id, mut control, _info) in nodes {
            let pattern = self.pattern(&node_id);
            let predicted = pattern.predict(next_hour);
            let idle = pool.idle_count(&node_id);

            if predicted > idle as u32 + PREWARM_HEADROOM {
                let to_open = (predicted - idle as u32).min(5); // cap at 5 per tick
                info!(
                    "🔥 Prewarm: opening {} streams for {} (predicted={}, idle={})",
                    to_open, node_id, predicted, idle
                );
                for _ in 0..to_open {
                    match control.open_stream().await {
                        Ok(stream) => {
                            pool.release(&node_id, stream);
                        }
                        Err(e) => {
                            warn!("Prewarm: failed to open stream for {}: {}", node_id, e);
                            break;
                        }
                    }
                }
            } else {
                debug!(
                    "Prewarm: {} ok (predicted={}, idle={})",
                    node_id, predicted, idle
                );
            }
        }

        // Prune stale patterns for nodes that are no longer registered
        self.patterns.retain(|node_id, _| {
            registry.get_by_id(node_id).is_some()
        });
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hourly_pattern_record_and_get() {
        let p = HourlyPattern::new();
        p.record(9);
        p.record(9);
        p.record(9);
        assert_eq!(p.get(9), 3);
        assert_eq!(p.get(10), 0);
    }

    #[test]
    fn test_hourly_pattern_out_of_bounds() {
        let p = HourlyPattern::new();
        p.record(255); // should not panic
        assert_eq!(p.get(255), 0);
    }

    #[test]
    fn test_predict_reflects_current_count() {
        let p = HourlyPattern::new();
        for _ in 0..7 {
            p.record(14);
        }
        assert_eq!(p.predict(14), 7);
    }

    #[test]
    fn test_engine_pattern_lazily_created() {
        let engine = PrewarmEngine::new(Duration::from_secs(60));
        engine.record_connection("node-x", 8);
        let pat = engine.pattern("node-x");
        assert_eq!(pat.get(8), 1);
    }

    #[test]
    fn test_engine_separate_patterns_per_node() {
        let engine = PrewarmEngine::new(Duration::from_secs(60));
        engine.record_connection("node-a", 10);
        engine.record_connection("node-b", 10);
        engine.record_connection("node-b", 10);
        assert_eq!(engine.pattern("node-a").get(10), 1);
        assert_eq!(engine.pattern("node-b").get(10), 2);
    }
}

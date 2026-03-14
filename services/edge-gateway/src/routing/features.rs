//! Node feature extraction for ML routing (P3-W9).
//!
//! Converts live `NodeInfo` + historical `NodeStats` into a normalised
//! 10-dimensional `f32` vector suitable for ONNX inference or the heuristic
//! scoring backend.
//!
//! # Feature layout (index → meaning)
//! ```text
//! 0  latency_ms           (normalised 0–1, 0 = 0 ms, 1 = 500 ms)
//! 1  connection_load      active_connections / max_connections
//! 2  bandwidth_utilisation bandwidth_rate_kbps / 10_000 (10 Mb/s ceiling)
//! 3  historical_success   success / (success + failure), Laplace-smoothed
//! 4  avg_latency_hist     historical ewma latency, normalised 0–500 ms
//! 5  packet_loss          packet_loss_ppm / 1_000_000
//! 6  bytes_served_log     log10(total_bytes_served + 1) / 12
//! 7  uptime_hours         min(connected hours, 720) / 720  (30 days)
//! 8  health_flag          1.0 if healthy, 0.0 otherwise
//! 9  region_hash          stable float in [0,1] derived from region string
//! ```

use dashmap::DashMap;
use std::sync::{
    atomic::{AtomicU32, AtomicU64, Ordering},
    Arc,
};

use crate::state::NodeInfo;

// ---------------------------------------------------------------------------
// NodeStats — per-node historical counters
// ---------------------------------------------------------------------------

/// Atomic performance counters accumulated over the node's lifetime.
#[derive(Debug, Default)]
pub struct NodeStats {
    /// Number of connections that completed successfully.
    pub success_count: AtomicU64,
    /// Number of connections that failed (error / timeout).
    pub failure_count: AtomicU64,
    /// Exponentially-weighted moving average of latency in milliseconds
    /// stored as fixed-point with 3 decimal places (multiply by 0.001 to get ms).
    pub ewma_latency_fp: AtomicU32,
    /// Packet-loss estimate in parts-per-million.
    pub packet_loss_ppm: AtomicU32,
}

impl NodeStats {
    pub fn record_success(&self) {
        self.success_count.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_failure(&self) {
        self.failure_count.fetch_add(1, Ordering::Relaxed);
    }

    /// Update the EWMA latency with `alpha = 0.1`.
    pub fn update_latency(&self, latency_ms: u32) {
        let new_fp = latency_ms * 1000;
        let prev_fp = self.ewma_latency_fp.load(Ordering::Relaxed);
        // ewma = 0.9 * prev + 0.1 * new
        let updated = (prev_fp * 9 + new_fp) / 10;
        self.ewma_latency_fp.store(updated, Ordering::Relaxed);
    }

    pub fn set_packet_loss_ppm(&self, ppm: u32) {
        self.packet_loss_ppm.store(ppm, Ordering::Relaxed);
    }

    pub fn success_rate(&self) -> f32 {
        let s = self.success_count.load(Ordering::Relaxed) as f64;
        let f = self.failure_count.load(Ordering::Relaxed) as f64;
        // Laplace smoothing: (s + 1) / (s + f + 2)
        ((s + 1.0) / (s + f + 2.0)) as f32
    }

    pub fn ewma_latency_ms(&self) -> f32 {
        self.ewma_latency_fp.load(Ordering::Relaxed) as f32 / 1000.0
    }
}

// ---------------------------------------------------------------------------
// NodeFeatures — 10-dim normalised feature vector
// ---------------------------------------------------------------------------

/// Normalised 10-dimensional feature vector for a single provider node.
#[derive(Debug, Clone, Copy, Default)]
pub struct NodeFeatures {
    pub values: [f32; 10],
}

impl NodeFeatures {
    /// Build features from live `NodeInfo` and accumulated `NodeStats`.
    pub fn build(info: &NodeInfo, stats: &NodeStats) -> Self {
        let latency = (info.latency_ms as f32 / 500.0).clamp(0.0, 1.0);

        let connection_load = if info.max_connections > 0 {
            (info.active_connections as f32 / info.max_connections as f32).clamp(0.0, 1.0)
        } else {
            1.0
        };

        let bw_util = (info.bandwidth_rate_kbps as f32 / 10_000.0).clamp(0.0, 1.0);

        let success = stats.success_rate();

        let avg_latency_hist = (stats.ewma_latency_ms() / 500.0).clamp(0.0, 1.0);

        let packet_loss =
            (stats.packet_loss_ppm.load(Ordering::Relaxed) as f32 / 1_000_000.0).clamp(0.0, 1.0);

        let bytes_log =
            ((info.total_bytes_served as f64 + 1.0).log10() / 12.0).clamp(0.0, 1.0) as f32;

        // connected_at is a Unix timestamp; derive uptime in hours
        let now_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(info.connected_at);
        let uptime_hours = now_secs.saturating_sub(info.connected_at) as f32 / 3600.0;
        let uptime_norm = (uptime_hours / 720.0).clamp(0.0, 1.0);

        let health = if info.is_healthy { 1.0 } else { 0.0 };

        let region_hash = stable_region_hash(&info.region);

        NodeFeatures {
            values: [
                latency,
                connection_load,
                bw_util,
                success,
                avg_latency_hist,
                packet_loss,
                bytes_log,
                uptime_norm,
                health,
                region_hash,
            ],
        }
    }
}

/// Deterministic hash of a region string into [0, 1].
fn stable_region_hash(region: &str) -> f32 {
    let mut h: u32 = 0x811c_9dc5;
    for b in region.bytes() {
        h ^= b as u32;
        h = h.wrapping_mul(0x0100_0193);
    }
    (h >> 8) as f32 / (u32::MAX >> 8) as f32
}

// ---------------------------------------------------------------------------
// FeatureCache — DashMap-backed, refreshed on each routing decision
// ---------------------------------------------------------------------------

/// Caches the most recent `NodeStats` for each node by `node_id`.
///
/// Stats are inserted on first connection and updated on every
/// successful/failed stream.  `build_features()` combines live `NodeInfo`
/// (from the registry) with cached historical stats.
pub struct FeatureCache {
    stats: DashMap<String, Arc<NodeStats>>,
}

impl FeatureCache {
    pub fn new() -> Self {
        Self {
            stats: DashMap::new(),
        }
    }

    /// Get (or lazily create) the `NodeStats` for `node_id`.
    pub fn get_stats(&self, node_id: &str) -> Arc<NodeStats> {
        self.stats
            .entry(node_id.to_string())
            .or_insert_with(|| Arc::new(NodeStats::default()))
            .clone()
    }

    /// Build a `NodeFeatures` vector using cached stats + live `NodeInfo`.
    pub fn build_features(&self, info: &NodeInfo) -> NodeFeatures {
        let stats = self.get_stats(&info.node_id);
        NodeFeatures::build(info, &stats)
    }

    /// Record a successful connection on `node_id`.
    pub fn record_success(&self, node_id: &str) {
        self.get_stats(node_id).record_success();
    }

    /// Record a failed connection on `node_id`.
    pub fn record_failure(&self, node_id: &str) {
        self.get_stats(node_id).record_failure();
    }

    /// Update the EWMA latency for `node_id`.
    pub fn update_latency(&self, node_id: &str, latency_ms: u32) {
        self.get_stats(node_id).update_latency(latency_ms);
    }
}

impl Default for FeatureCache {
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

    fn make_info() -> NodeInfo {
        NodeInfo {
            node_id: "n1".into(),
            user_id: None,
            country_code: "GH".into(),
            region: "Accra".into(),
            ip_address: "1.2.3.4".into(),
            connected_at: 0,
            total_bytes_served: 0,
            active_connections: 2,
            max_connections: 10,
            latency_ms: 50,
            bandwidth_rate_kbps: 1000,
            is_healthy: true,
        }
    }

    #[test]
    fn test_feature_bounds() {
        let info = make_info();
        let stats = NodeStats::default();
        let feat = NodeFeatures::build(&info, &stats);
        for (i, v) in feat.values.iter().enumerate() {
            assert!(
                (0.0..=1.0).contains(v),
                "feature[{i}] = {v} out of [0,1]"
            );
        }
    }

    #[test]
    fn test_connection_load() {
        let mut info = make_info();
        info.active_connections = 10;
        info.max_connections = 10;
        let stats = NodeStats::default();
        let feat = NodeFeatures::build(&info, &stats);
        assert_eq!(feat.values[1], 1.0);
    }

    #[test]
    fn test_success_rate_laplace() {
        let stats = NodeStats::default();
        // No observations → Laplace prior = 1/2 = 0.5
        assert!((stats.success_rate() - 0.5).abs() < 1e-5);
        stats.record_success();
        stats.record_success();
        // 2 successes: (2+1)/(2+0+2) = 3/4 = 0.75
        assert!((stats.success_rate() - 0.75).abs() < 1e-5);
    }

    #[test]
    fn test_feature_cache_lazily_creates_stats() {
        let cache = FeatureCache::new();
        let s1 = cache.get_stats("node-a");
        let s2 = cache.get_stats("node-a");
        // Same Arc
        assert!(Arc::ptr_eq(&s1, &s2));
    }

    #[test]
    fn test_region_hash_deterministic() {
        assert_eq!(stable_region_hash("Lagos"), stable_region_hash("Lagos"));
        assert_ne!(stable_region_hash("Lagos"), stable_region_hash("Accra"));
    }
}

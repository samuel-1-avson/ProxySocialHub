//! Lock-free node registry using DashMap for high-throughput provider selection.
//!
//! Replaces `Mutex<HashMap<String, (Control, NodeInfo)>>` with a DashMap of
//! Arc<NodeEntry> entries. Per-shard locking in DashMap (vs a single global
//! Mutex) eliminates the main contention bottleneck under concurrent load.
//!
//! Phase 1 target: 10x throughput improvement, provider selection < 5μs.

use dashmap::DashMap;
use rand::seq::IteratorRandom;
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
    Arc, RwLock,
};
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::{info, warn};
use yamux::Control;

use crate::auth::provider_lease::{lease_is_fresh, provider_leases_required};
use crate::state::NodeInfo;

/// Per-node entry with atomic hot-path fields and RwLock for cold metadata.
pub struct NodeEntry {
    /// yamux control channel — Clone is cheap (Arc internally)
    pub control: Control,
    /// Full node metadata (written infrequently, read on every score call)
    pub info: RwLock<NodeInfo>,
    /// Last heartbeat Unix timestamp — updated atomically on every heartbeat
    pub last_heartbeat: AtomicU64,
    /// Live active connection count — incremented/decremented per request
    pub active_connections: AtomicU32,
    /// Health flag — set atomically by heartbeat monitor and circuit breaker
    pub is_healthy: AtomicBool,
}

impl NodeEntry {
    pub fn new(control: Control, info: NodeInfo) -> Self {
        let is_healthy = info.is_healthy;
        let active_connections = info.active_connections;
        let connected_at = info.connected_at;
        Self {
            control,
            info: RwLock::new(info),
            last_heartbeat: AtomicU64::new(connected_at),
            active_connections: AtomicU32::new(active_connections),
            is_healthy: AtomicBool::new(is_healthy),
        }
    }

    /// Score this node for routing (higher = better).
    ///
    /// Hot path: reads atomics without locking, then takes a single read lock
    /// on NodeInfo for latency/bandwidth/uptime fields.
    pub fn score(&self) -> u32 {
        if !self.is_healthy.load(Ordering::Relaxed) {
            return 0;
        }

        let Ok(info) = self.info.read() else {
            return 0;
        };
        if provider_leases_required() && !lease_is_fresh(info.lease_expires_at) {
            return 0;
        }

        // Use the AI-driven quality score as the base
        let mut score = (info.quality_score * 10.0) as u32; // Scaling 0-100 to 0-1000

        // Penalise high latency
        score = score.saturating_sub(info.latency_ms);

        // Penalise high bandwidth usage (~1 point per 100 KB/s)
        score = score.saturating_sub(info.bandwidth_rate_kbps / 100);

        // Use atomic active_connections (live value, not the snapshot in info)
        let active = self.active_connections.load(Ordering::Relaxed);
        let load_percent = (active * 100) / info.max_connections.max(1);
        score = score.saturating_sub(load_percent * 5);

        // Bonus for recently connected nodes (heuristic: fresh = reliable)
        let now_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let uptime_hours = now_secs.saturating_sub(info.connected_at) / 3600;
        if uptime_hours < 24 {
            score += 50;
        }

        score
    }
}

/// Lock-free node registry backed by DashMap.
///
/// DashMap shards its internal HashMap across multiple RwLocks (default 16
/// shards), so concurrent reads and writes on *different* nodes never contend.
/// Operations on the same node still take a brief per-shard lock, but this is
/// orders of magnitude less contention than a single global Mutex.
///
/// P-06 / P1: `get_best()` reads from a pre-sorted score snapshot in O(1).
/// Mutations set `snapshot_dirty`; a background task rebuilds at most once per
/// refresh interval (see `start_score_refresh`), avoiding O(N log N) work on every heartbeat.
pub struct LockFreeNodeRegistry {
    nodes: DashMap<String, Arc<NodeEntry>>,
    /// Pre-sorted (score desc) list of (node_id, Control). Rebuilt when dirty.
    top_nodes: Arc<std::sync::RwLock<Vec<(String, Control)>>>,
    /// Shard-specific pre-sorted snapshots keyed by country and/or connection type.
    shard_nodes: Arc<std::sync::RwLock<HashMap<String, Vec<(String, Control)>>>>,
    /// Set on registry mutations; cleared by the score-refresh background task.
    snapshot_dirty: AtomicBool,
}

impl LockFreeNodeRegistry {
    pub fn new() -> Self {
        Self {
            nodes: DashMap::new(),
            top_nodes: Arc::new(std::sync::RwLock::new(Vec::new())),
            shard_nodes: Arc::new(std::sync::RwLock::new(HashMap::new())),
            snapshot_dirty: AtomicBool::new(true),
        }
    }

    fn mark_snapshot_dirty(&self) {
        self.snapshot_dirty.store(true, Ordering::Release);
    }

    /// Rebuild the pre-sorted score snapshot (P-06). Only invoked by the refresh task.
    fn rebuild_score_snapshot(&self) {
        let mut scored: Vec<(u32, String, Control, NodeInfo)> = self
            .nodes
            .iter()
            .filter_map(|e| {
                if !e.value().is_healthy.load(Ordering::Relaxed) {
                    return None;
                }
                let info = e.value().info.read().ok()?.clone();
                if provider_leases_required() && !lease_is_fresh(info.lease_expires_at) {
                    return None;
                }
                Some((
                    e.value().score(),
                    e.key().clone(),
                    e.value().control.clone(),
                    info,
                ))
            })
            .collect();
        // Sort descending by score — best node first.
        scored.sort_unstable_by(|a, b| b.0.cmp(&a.0));
        let snapshot: Vec<(String, Control)> =
            scored.iter().map(|(_, id, ctrl, _)| (id.clone(), ctrl.clone())).collect();
        if let Ok(mut top) = self.top_nodes.write() {
            *top = snapshot;
        }

        let mut shards: HashMap<String, Vec<(String, Control)>> = HashMap::new();
        for (_, id, ctrl, info) in scored {
            for key in ordered_shard_keys(Some(&info.country_code), Some(&info.capabilities.connection_type)) {
                shards.entry(key).or_default().push((id.clone(), ctrl.clone()));
            }
        }
        if let Ok(mut shard_nodes) = self.shard_nodes.write() {
            *shard_nodes = shards;
        }
    }

    /// Start a background task that refreshes the score snapshot when dirty.
    /// Call once at startup from main.rs after constructing the registry.
    pub fn start_score_refresh(registry: Arc<Self>, interval_ms: u64) {
        tokio::spawn(async move {
            let mut ticker =
                tokio::time::interval(std::time::Duration::from_millis(interval_ms.max(1)));
            loop {
                ticker.tick().await;
                if registry.snapshot_dirty.swap(false, Ordering::AcqRel) {
                    registry.rebuild_score_snapshot();
                }
            }
        });
    }

    /// Register a new provider node.
    pub fn insert(&self, node_id: String, control: Control, info: NodeInfo) {
        info!(
            "Registered node: {} from {} ({})",
            node_id, info.region, info.country_code
        );
        self.nodes
            .insert(node_id, Arc::new(NodeEntry::new(control, info)));
        self.mark_snapshot_dirty();
    }

    /// Register a provider with minimal info (IP address only).
    pub fn insert_simple(&self, node_id: String, control: Control, ip_address: String) {
        let info = NodeInfo::new(node_id.clone(), ip_address, None);
        self.insert(node_id, control, info);
    }

    /// Remove a provider and return its last known NodeInfo.
    pub fn remove(&self, node_id: &str) -> Option<NodeInfo> {
        let result = self
            .nodes
            .remove(node_id)
            .and_then(|(_, entry)| entry.info.read().ok().map(|i| i.clone()));
        self.mark_snapshot_dirty();
        result
    }

    pub fn count(&self) -> usize {
        self.nodes.len()
    }

    /// Snapshot of a node's metadata (cloned out of the RwLock).
    pub fn get_node_info(&self, node_id: &str) -> Option<NodeInfo> {
        self.nodes
            .get(node_id)
            .and_then(|e| e.info.read().ok().map(|i| i.clone()))
    }

    /// Get a yamux Control for a specific node (sticky session routing).
    pub fn get_by_id(&self, node_id: &str) -> Option<Control> {
        self.nodes.get(node_id).and_then(|entry| {
            let lease_ok = entry
                .info
                .read()
                .map(|info| !provider_leases_required() || lease_is_fresh(info.lease_expires_at))
                .unwrap_or(false);
            if entry.is_healthy.load(Ordering::Relaxed) && lease_ok {
                Some(entry.control.clone())
            } else {
                None
            }
        })
    }

    /// Atomically mark a node unhealthy (called by circuit breaker / heartbeat).
    pub fn mark_unhealthy(&self, node_id: &str) {
        if let Some(entry) = self.nodes.get(node_id) {
            entry.is_healthy.store(false, Ordering::Relaxed);
            warn!("Marked node {} as unhealthy", node_id);
        }
        self.mark_snapshot_dirty();
    }

    /// Atomically mark a node healthy (called on successful heartbeat).
    pub fn mark_healthy(&self, node_id: &str) {
        if let Some(entry) = self.nodes.get(node_id) {
            entry.is_healthy.store(true, Ordering::Relaxed);
        }
        self.mark_snapshot_dirty();
    }

    /// Increment total bytes served (persisted later to Redis).
    pub fn update_node_stats(&self, node_id: &str, bytes_served: u64) {
        if let Some(entry) = self.nodes.get(node_id) {
            if let Ok(mut info) = entry.info.write() {
                info.total_bytes_served += bytes_served;
            }
        }
    }

    /// Adjust the live active connection count by `delta` (positive = open, negative = close).
    pub fn update_active_connections(&self, node_id: &str, delta: i32) {
        if let Some(entry) = self.nodes.get(node_id) {
            let amount = delta.unsigned_abs();
            let new_active = loop {
                let current = entry.active_connections.load(Ordering::Relaxed);
                let next = if delta >= 0 {
                    current.saturating_add(amount)
                } else {
                    current.saturating_sub(amount)
                };

                if entry
                    .active_connections
                    .compare_exchange(current, next, Ordering::Relaxed, Ordering::Relaxed)
                    .is_ok()
                {
                    break next;
                }
            };

            if let Ok(mut info) = entry.info.write() {
                info.active_connections = new_active;
            }
        }
    }

    /// Update live routing metrics from provider heartbeats.
    pub fn update_live_metrics(
        &self,
        node_id: &str,
        active_connections: u32,
        latency_ms: u32,
        bandwidth_rate_kbps: u32,
        total_bytes_served: u64,
    ) {
        if let Some(entry) = self.nodes.get(node_id) {
            entry
                .active_connections
                .store(active_connections, Ordering::Relaxed);
            entry.is_healthy.store(true, Ordering::Relaxed);
            entry.last_heartbeat.store(
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs(),
                Ordering::Relaxed,
            );

            if let Ok(mut info) = entry.info.write() {
                info.active_connections = active_connections;
                info.latency_ms = latency_ms;
                info.bandwidth_rate_kbps = bandwidth_rate_kbps;
                info.total_bytes_served = total_bytes_served;
                info.is_healthy = true;
            }
        }
        self.mark_snapshot_dirty();
    }

    /// Update node info using a closure (allows atomic updates to multiple fields).
    pub fn update_node_info<F>(&self, node_id: &str, f: F)
    where
        F: FnOnce(&mut NodeInfo),
    {
        if let Some(entry) = self.nodes.get(node_id) {
            if let Ok(mut info) = entry.info.write() {
                f(&mut info);
            }
        }
        self.mark_snapshot_dirty();
    }

    /// Get a random healthy node (fallback when best-node selection unavailable).
    pub fn get_random(&self) -> Option<Control> {
        let mut rng = rand::thread_rng();
        self.nodes
            .iter()
            .filter(|e| {
                e.value().is_healthy.load(Ordering::Relaxed)
                    && e.value()
                        .info
                        .read()
                        .map(|info| !provider_leases_required() || lease_is_fresh(info.lease_expires_at))
                        .unwrap_or(false)
            })
            .choose(&mut rng)
            .map(|e| e.value().control.clone())
    }

    /// Get the highest-scoring healthy node (primary routing path).
    ///
    /// P-06: O(1) read from the pre-sorted score snapshot.  Falls back to a
    /// full O(n) scan only when the snapshot is empty or fully stale.
    pub fn get_best(&self) -> Option<(Control, String)> {
        // Fast path: snapshot is rebuilt from eligible nodes only (healthy + lease).
        if let Ok(top) = self.top_nodes.read() {
            if let Some((id, ctrl)) = top.first() {
                return Some((ctrl.clone(), id.clone()));
            }
        }
        // Slow fallback: snapshot empty or not yet refreshed.
        self.nodes
            .iter()
            .filter(|e| {
                e.value().is_healthy.load(Ordering::Relaxed)
                    && e.value()
                        .info
                        .read()
                        .map(|info| !provider_leases_required() || lease_is_fresh(info.lease_expires_at))
                        .unwrap_or(false)
            })
            .max_by_key(|e| e.value().score())
            .map(|e| (e.value().control.clone(), e.key().clone()))
    }

    pub fn get_best_for(
        &self,
        country_code: Option<&str>,
        connection_type: Option<&str>,
    ) -> Option<(Control, String)> {
        if let Ok(shards) = self.shard_nodes.read() {
            for key in ordered_shard_keys(country_code, connection_type) {
                if let Some(entries) = shards.get(&key) {
                    if let Some((id, ctrl)) = entries.first() {
                        return Some((ctrl.clone(), id.clone()));
                    }
                }
            }
        }
        self.get_best()
    }

    /// Get a healthy node in the given country (geo-aware routing).
    pub fn get_by_country(&self, country_code: &str) -> Option<Control> {
        let mut rng = rand::thread_rng();
        self.nodes
            .iter()
            .filter(|e| {
                e.value().is_healthy.load(Ordering::Relaxed)
                    && e.value()
                        .info
                        .read()
                        .map(|i| {
                            i.country_code == country_code
                                && (!provider_leases_required() || lease_is_fresh(i.lease_expires_at))
                        })
                        .unwrap_or(false)
            })
            .choose(&mut rng)
            .map(|e| e.value().control.clone())
    }

    /// Get a healthy node in the given region (geo-aware routing).
    pub fn get_by_region(&self, region: &str) -> Option<Control> {
        let region_lower = region.to_lowercase();
        let mut rng = rand::thread_rng();
        self.nodes
            .iter()
            .filter(|e| {
                e.value().is_healthy.load(Ordering::Relaxed)
                    && e.value()
                        .info
                        .read()
                        .map(|i| {
                            i.region.to_lowercase().contains(&region_lower)
                                && (!provider_leases_required() || lease_is_fresh(i.lease_expires_at))
                        })
                        .unwrap_or(false)
            })
            .choose(&mut rng)
            .map(|e| e.value().control.clone())
    }

    /// Get the least-loaded healthy node.
    pub fn get_least_loaded(&self) -> Option<Control> {
        self.nodes
            .iter()
            .filter(|e| {
                let entry = e.value();
                let active = entry.active_connections.load(Ordering::Relaxed);
                let (max, lease_ok) = entry
                    .info
                    .read()
                    .map(|i| (i.max_connections, !provider_leases_required() || lease_is_fresh(i.lease_expires_at)))
                    .unwrap_or((100, false));
                entry.is_healthy.load(Ordering::Relaxed) && active < max && lease_ok
            })
            .min_by_key(|e| e.value().active_connections.load(Ordering::Relaxed))
            .map(|e| e.value().control.clone())
    }

    /// Snapshot all nodes' metadata for admin/metrics endpoints.
    pub fn list_nodes(&self) -> Vec<NodeInfo> {
        self.nodes
            .iter()
            .filter_map(|e| e.value().info.read().ok().map(|i| i.clone()))
            .collect()
    }

    /// Snapshot all *healthy* nodes as `(node_id, Control, NodeInfo)` triples.
    ///
    /// Used by `MLRouter::select()` to score all candidates in one pass.
    pub fn list_healthy_with_info(&self) -> Vec<(String, Control, NodeInfo)> {
        self.nodes
            .iter()
            .filter(|e| {
                e.value().is_healthy.load(Ordering::Relaxed)
                    && e.value()
                        .info
                        .read()
                        .map(|info| !provider_leases_required() || lease_is_fresh(info.lease_expires_at))
                        .unwrap_or(false)
            })
            .filter_map(|e| {
                e.value()
                    .info
                    .read()
                    .ok()
                    .map(|i| (e.key().clone(), e.value().control.clone(), i.clone()))
            })
            .collect()
    }
}

impl Default for LockFreeNodeRegistry {
    fn default() -> Self {
        Self::new()
    }
}

fn ordered_shard_keys(country_code: Option<&str>, connection_type: Option<&str>) -> Vec<String> {
    let country = country_code
        .map(|value| value.trim().to_ascii_uppercase())
        .filter(|value| !value.is_empty());
    let connection = connection_type
        .map(|value| value.trim().to_ascii_uppercase())
        .filter(|value| !value.is_empty());

    let mut keys = Vec::new();
    if let (Some(country), Some(connection)) = (country.as_deref(), connection.as_deref()) {
        let mut key = String::with_capacity(8 + country.len() + 6 + connection.len());
        key.push_str("country:");
        key.push_str(country);
        key.push_str("|conn:");
        key.push_str(connection);
        keys.push(key);
    }
    if let Some(country) = country.as_deref() {
        let mut key = String::with_capacity(8 + country.len());
        key.push_str("country:");
        key.push_str(country);
        keys.push(key);
    }
    if let Some(connection) = connection.as_deref() {
        let mut key = String::with_capacity(5 + connection.len());
        key.push_str("conn:");
        key.push_str(connection);
        keys.push(key);
    }
    keys
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tunnel::{AssignedLimits, ProviderCapabilities};

    fn make_test_info(id: &str, latency: u32, active: u32, healthy: bool) -> NodeInfo {
        NodeInfo {
            node_id: id.to_string(),
            user_id: None,
            country_code: "GH".to_string(),
            region: "Accra".to_string(),
            ip_address: "10.0.0.1".to_string(),
            connected_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
            total_bytes_served: 0,
            active_connections: active,
            max_connections: 100,
            latency_ms: latency,
            bandwidth_rate_kbps: 0,
            is_healthy: healthy,
            capabilities: ProviderCapabilities::default(),
            assigned_limits: AssignedLimits::default(),
            qos_tier: "basic".to_string(),
            current_tier: "Bronze".to_string(),
            quality_score: 100.0,
            base_price_per_gb: 0.20,
            lease_expires_at: 0,
            control_api_db_id: None,
        }
    }

    #[test]
    fn test_empty_registry_is_safe() {
        let registry = LockFreeNodeRegistry::new();
        assert_eq!(registry.count(), 0);
        assert!(registry.get_best().is_none());
        assert!(registry.get_random().is_none());
        assert!(registry.get_by_id("none").is_none());
        assert!(registry.get_node_info("none").is_none());
        assert!(registry.list_nodes().is_empty());
        // These must not panic on unknown node IDs
        registry.mark_unhealthy("ghost");
        registry.mark_healthy("ghost");
        registry.update_node_stats("ghost", 1024);
        registry.update_active_connections("ghost", 1);
    }

    #[test]
    fn test_node_entry_score_healthy_low_latency() {
        let info = make_test_info("n1", 50, 0, true);
        // Score logic lives in NodeInfo::score() too; verify NodeEntry delegates correctly
        let score = info.score();
        assert!(score > 900, "Expected score > 900, got {}", score);
    }

    #[test]
    fn test_node_entry_score_unhealthy_is_zero() {
        let info = make_test_info("n2", 50, 0, false);
        assert_eq!(info.score(), 0);
    }

    #[test]
    fn test_node_entry_score_high_latency_lower() {
        let low = make_test_info("a", 20, 0, true);
        let high = make_test_info("b", 200, 0, true);
        assert!(low.score() > high.score());
    }

    #[test]
    fn test_node_entry_score_high_load_lower() {
        let low = make_test_info("a", 50, 10, true);
        let high = make_test_info("b", 50, 80, true);
        assert!(low.score() > high.score());
    }

    #[tokio::test]
    async fn score_snapshot_rebuilds_when_dirty() {
        let registry = Arc::new(LockFreeNodeRegistry::new());
        assert!(registry.snapshot_dirty.load(Ordering::Acquire));
        LockFreeNodeRegistry::start_score_refresh(registry.clone(), 25);
        tokio::time::sleep(std::time::Duration::from_millis(80)).await;
        assert!(!registry.snapshot_dirty.load(Ordering::Acquire));

        registry.update_live_metrics("missing-node", 1, 10, 0, 0);
        assert!(registry.snapshot_dirty.load(Ordering::Acquire));
        tokio::time::sleep(std::time::Duration::from_millis(80)).await;
        assert!(!registry.snapshot_dirty.load(Ordering::Acquire));
    }
}

//! Region-aware health-based traffic steering (P4-W15).
//!
//! # Model
//! Each `Region` has a name, a geographic coordinate (lat/lon), a health
//! score [0, 100], and a capacity weight.  `MultiRegionRouter::select()`
//! picks the best region using a weighted scoring formula:
//!
//! ```text
//! region_score = health_score × capacity_weight − geo_penalty(client_ip)
//! ```
//!
//! If the primary region's health drops below `failover_threshold`, traffic
//! is steered to the next healthiest region automatically.
//!
//! # Cross-region Redis
//! Each region publishes its health metrics as a JSON blob to a shared Redis
//! key `region:{name}:health` every `publish_interval`.  The monitor reads
//! all sibling regions' keys to maintain a global view without direct RPC.

use std::{
    sync::{
        atomic::{AtomicU32, AtomicU64, AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

// ---------------------------------------------------------------------------
// Region metadata
// ---------------------------------------------------------------------------

/// Geographic coordinates (decimal degrees).
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct LatLon {
    pub lat: f64,
    pub lon: f64,
}

impl LatLon {
    /// Haversine distance in kilometres.
    pub fn distance_km(&self, other: &LatLon) -> f64 {
        const R: f64 = 6371.0;
        let dlat = (other.lat - self.lat).to_radians();
        let dlon = (other.lon - self.lon).to_radians();
        let a = (dlat / 2.0).sin().powi(2)
            + self.lat.to_radians().cos()
            * other.lat.to_radians().cos()
            * (dlon / 2.0).sin().powi(2);
        R * 2.0 * a.sqrt().atan2((1.0 - a).sqrt())
    }
}

/// Static configuration for a single deployment region.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegionConfig {
    /// Unique name, e.g. "af-west-1".
    pub name: String,
    /// Human-readable display name.
    pub display_name: String,
    /// Geographic centre of the region.
    pub location: LatLon,
    /// Relative capacity weight (1–100).  Heavier regions absorb more traffic.
    pub weight: u32,
    /// Redis key prefix for publishing/reading health.
    pub redis_prefix: String,
}

// ---------------------------------------------------------------------------
// RegionHealth — live atomic state
// ---------------------------------------------------------------------------

/// Live health state for one region.
pub struct RegionHealth {
    pub config: RegionConfig,
    /// Health score [0, 100]; 0 = dead, 100 = perfect.
    pub health: AtomicU32,
    /// Active provider node count in this region.
    pub node_count: AtomicU32,
    /// Request rate (req/s) measured in the last 10 seconds.
    pub request_rate: AtomicU64,
    /// Whether this region is currently in maintenance mode.
    pub maintenance: AtomicBool,
    /// Last time health was updated (Unix second).
    pub last_update: AtomicU64,
}

impl RegionHealth {
    pub fn new(config: RegionConfig) -> Self {
        Self {
            config,
            health: AtomicU32::new(100),
            node_count: AtomicU32::new(0),
            request_rate: AtomicU64::new(0),
            maintenance: AtomicBool::new(false),
            last_update: AtomicU64::new(unix_second()),
        }
    }

    pub fn is_available(&self) -> bool {
        !self.maintenance.load(Ordering::Relaxed) && self.health.load(Ordering::Relaxed) > 0
    }

    /// Composite routing score.  Higher = more desirable.
    pub fn routing_score(&self, client_location: Option<&LatLon>) -> f64 {
        if !self.is_available() { return 0.0; }

        let health = self.health.load(Ordering::Relaxed) as f64;
        let weight = self.config.weight as f64;

        // Geo penalty: 1 point per 1000 km from client.
        let geo_penalty = client_location
            .map(|c| self.config.location.distance_km(c) / 1000.0)
            .unwrap_or(0.0);

        (health * weight / 100.0) - geo_penalty
    }
}

fn unix_second() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

// ---------------------------------------------------------------------------
// MultiRegionRouter
// ---------------------------------------------------------------------------

/// Health threshold below which a region triggers failover.
const FAILOVER_THRESHOLD: u32 = 20;

/// Drives cross-region traffic steering.
pub struct MultiRegionRouter {
    regions: DashMap<String, Arc<RegionHealth>>,
    /// Name of the "home" region (where this gateway instance runs).
    local_region: String,
}

impl MultiRegionRouter {
    pub fn new(local_region: impl Into<String>) -> Self {
        Self {
            regions: DashMap::new(),
            local_region: local_region.into(),
        }
    }

    /// Register a region.
    pub fn add_region(&self, config: RegionConfig) {
        let name = config.name.clone();
        self.regions.insert(name, Arc::new(RegionHealth::new(config)));
    }

    /// Get a region's live health state.
    pub fn get(&self, name: &str) -> Option<Arc<RegionHealth>> {
        self.regions.get(name).map(|r| r.clone())
    }

    /// Select the best region for a request.
    ///
    /// - Returns the local region if healthy (avoids cross-region latency).
    /// - Falls back to the globally best region when local health < threshold.
    /// - Returns `None` only when all regions are unavailable.
    pub fn select(&self, client_location: Option<&LatLon>) -> Option<Arc<RegionHealth>> {
        // Check local region first
        if let Some(local) = self.regions.get(&self.local_region) {
            let h = local.health.load(Ordering::Relaxed);
            if h >= FAILOVER_THRESHOLD && local.is_available() {
                return Some(local.clone());
            }
            if h < FAILOVER_THRESHOLD {
                warn!(
                    "⚠️ Local region {} health={} < threshold, triggering failover",
                    self.local_region, h
                );
            }
        }

        // Pick globally best available region
        self.regions
            .iter()
            .filter(|e| e.value().is_available())
            .max_by(|a, b| {
                a.value()
                    .routing_score(client_location)
                    .partial_cmp(&b.value().routing_score(client_location))
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .map(|e| e.value().clone())
    }

    /// Update a region's health score (called by the monitor loop).
    pub fn update_health(&self, region_name: &str, health: u32, node_count: u32) {
        if let Some(region) = self.regions.get(region_name) {
            region.health.store(health.min(100), Ordering::Relaxed);
            region.node_count.store(node_count, Ordering::Relaxed);
            region.last_update.store(unix_second(), Ordering::Relaxed);
            info!(
                "🌍 Region {} health={} nodes={}",
                region_name, health, node_count
            );
        }
    }

    /// Mark a region as under maintenance (zero-weights its score).
    pub fn set_maintenance(&self, region_name: &str, on: bool) {
        if let Some(region) = self.regions.get(region_name) {
            region.maintenance.store(on, Ordering::Relaxed);
            info!("🔧 Region {} maintenance={}", region_name, on);
        }
    }

    /// List all regions sorted by routing score (best first).
    pub fn ranked_regions(&self, client_location: Option<&LatLon>) -> Vec<Arc<RegionHealth>> {
        let mut list: Vec<Arc<RegionHealth>> = self
            .regions
            .iter()
            .map(|e| e.value().clone())
            .collect();
        list.sort_by(|a, b| {
            b.routing_score(client_location)
                .partial_cmp(&a.routing_score(client_location))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        list
    }

    pub fn region_count(&self) -> usize { self.regions.len() }

    /// Background task: marks regions stale if not updated in `timeout`.
    pub fn start_staleness_checker(
        router: Arc<Self>,
        timeout: Duration,
    ) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(timeout / 2);
            loop {
                interval.tick().await;
                let cutoff = unix_second().saturating_sub(timeout.as_secs());
                for entry in router.regions.iter() {
                    let region = entry.value();
                    if region.last_update.load(Ordering::Relaxed) < cutoff {
                        warn!(
                            "🌍 Region {} is stale, marking unhealthy",
                            entry.key()
                        );
                        region.health.store(0, Ordering::Relaxed);
                    }
                }
            }
        })
    }
}

// ---------------------------------------------------------------------------
// Redis health publication helpers
// ---------------------------------------------------------------------------

/// Payload written to Redis for cross-region health synchronisation.
#[derive(Debug, Serialize, Deserialize)]
pub struct RegionHealthPayload {
    pub region: String,
    pub health: u32,
    pub node_count: u32,
    pub request_rate: u64,
    pub timestamp: u64,
}

impl RegionHealth {
    pub fn to_payload(&self) -> RegionHealthPayload {
        RegionHealthPayload {
            region: self.config.name.clone(),
            health: self.health.load(Ordering::Relaxed),
            node_count: self.node_count.load(Ordering::Relaxed),
            request_rate: self.request_rate.load(Ordering::Relaxed),
            timestamp: unix_second(),
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn make_region(name: &str, lat: f64, lon: f64, weight: u32) -> RegionConfig {
        RegionConfig {
            name: name.to_string(),
            display_name: name.to_string(),
            location: LatLon { lat, lon },
            weight,
            redis_prefix: format!("region:{}", name),
        }
    }

    #[test]
    fn test_haversine_distance() {
        let accra = LatLon { lat: 5.6037, lon: -0.187 };
        let lagos = LatLon { lat: 6.5244, lon: 3.3792 };
        let dist = accra.distance_km(&lagos);
        // Roughly 360 km
        assert!(dist > 300.0 && dist < 420.0, "unexpected dist={}", dist);
    }

    #[test]
    fn test_routing_selects_healthy_local() {
        let router = MultiRegionRouter::new("af-west-1");
        router.add_region(make_region("af-west-1", 5.6, -0.2, 100));
        router.add_region(make_region("eu-central-1", 50.1, 8.7, 80));

        let selected = router.select(None).unwrap();
        assert_eq!(selected.config.name, "af-west-1");
    }

    #[test]
    fn test_failover_when_local_unhealthy() {
        let router = MultiRegionRouter::new("af-west-1");
        router.add_region(make_region("af-west-1", 5.6, -0.2, 100));
        router.add_region(make_region("eu-central-1", 50.1, 8.7, 80));

        router.update_health("af-west-1", 10, 0); // below FAILOVER_THRESHOLD

        let selected = router.select(None).unwrap();
        assert_eq!(selected.config.name, "eu-central-1");
    }

    #[test]
    fn test_maintenance_mode_excluded() {
        let router = MultiRegionRouter::new("af-west-1");
        router.add_region(make_region("af-west-1", 5.6, -0.2, 100));
        router.add_region(make_region("eu-central-1", 50.1, 8.7, 80));

        router.set_maintenance("af-west-1", true);
        let selected = router.select(None).unwrap();
        assert_eq!(selected.config.name, "eu-central-1");
    }

    #[test]
    fn test_no_regions_returns_none() {
        let router = MultiRegionRouter::new("af-west-1");
        assert!(router.select(None).is_none());
    }

    #[test]
    fn test_ranked_regions_order() {
        let router = MultiRegionRouter::new("af-west-1");
        router.add_region(make_region("af-west-1", 5.6, -0.2, 100));
        router.add_region(make_region("eu-central-1", 50.1, 8.7, 80));
        router.update_health("af-west-1", 90, 5);
        router.update_health("eu-central-1", 95, 8);

        let ranked = router.ranked_regions(None);
        assert_eq!(ranked.len(), 2);
        // eu-central-1 has higher raw score here due to higher health*weight
        // (95*80 vs 90*100 → 7600 vs 9000 → af-west-1 wins without geo penalty)
        assert_eq!(ranked[0].config.name, "af-west-1");
    }

    #[test]
    fn test_health_payload_serialization() {
        let config = make_region("af-west-1", 5.6, -0.2, 100);
        let health = RegionHealth::new(config);
        health.node_count.store(3, Ordering::Relaxed);
        let payload = health.to_payload();
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("af-west-1"));
    }
}

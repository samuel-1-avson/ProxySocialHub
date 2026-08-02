use crate::circuitbreaker::CircuitBreakerManager;
use crate::config::Config;
use crate::registry::lockfree::LockFreeNodeRegistry;
use crate::tunnel::{AssignedLimits, ProviderCapabilities};
use governor::clock::DefaultClock;
use governor::state::keyed::DefaultKeyedStateStore;
use governor::{Quota, RateLimiter};
use rand::seq::SliceRandom;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::num::NonZeroU32;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use yamux::Control;

/// Provider node metadata for intelligent routing
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NodeInfo {
    pub node_id: String,
    pub user_id: Option<String>,
    pub country_code: String, // ISO 3166-1 alpha-2 (e.g., "GH", "NG", "KE")
    pub region: String,       // Region/city (e.g., "Accra", "Lagos")
    /// Authoritative ISP name from control-api GeoIP (empty until resolved) — GW-04.
    #[serde(default)]
    pub isp: String,
    pub ip_address: String,
    pub connected_at: u64, // Unix timestamp
    pub total_bytes_served: u64,
    pub active_connections: u32,
    pub max_connections: u32,
    pub latency_ms: u32, // Last measured latency
    #[serde(default)]
    pub bandwidth_rate_kbps: u32, // Estimated bandwidth usage (KB/s)
    pub is_healthy: bool,
    // P1-A6: Provider capabilities and assigned limits
    #[serde(default)]
    pub capabilities: ProviderCapabilities,
    #[serde(default)]
    pub assigned_limits: AssignedLimits,
    #[serde(default)]
    pub qos_tier: String,
    #[serde(default = "default_bronze")]
    pub current_tier: String,
    pub quality_score: f64,
    pub base_price_per_gb: f64,
    #[serde(default)]
    pub lease_expires_at: u64,
    /// control-api `nodes.id` (UUID) returned from gateway register; used for offline status updates.
    #[serde(default)]
    pub control_api_db_id: Option<String>,
    /// Provider daemon run/session ID for cross-service troubleshooting.
    #[serde(default)]
    pub provider_run_id: String,
}

fn default_bronze() -> String {
    "Bronze".to_string()
}

impl NodeInfo {
    pub fn new(node_id: String, ip_address: String, user_id: Option<String>) -> Self {
        Self {
            node_id,
            user_id,
            country_code: "GH".to_string(), // Default to Ghana
            region: "Unknown".to_string(),
            isp: String::new(),
            ip_address,
            connected_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_else(|_| Duration::from_secs(0))
                .as_secs(),
            total_bytes_served: 0,
            active_connections: 0,
            max_connections: 100,
            latency_ms: 0,
            bandwidth_rate_kbps: 0,
            is_healthy: true,
            // P1-A6: Initialize with defaults
            capabilities: ProviderCapabilities::default(),
            assigned_limits: AssignedLimits {
                max_connections: 100,
                bandwidth_cap_mbps: 100,
                allowed_ports: vec![80, 443],
                qos_tier: "basic".to_string(),
                priority: 50,
            },
            qos_tier: "basic".to_string(),
            current_tier: "Bronze".to_string(),
            quality_score: 100.0,
            base_price_per_gb: 0.20,
            lease_expires_at: 0,
            control_api_db_id: None,
            provider_run_id: String::new(),
        }
    }

    /// P1-A6: Create NodeInfo with capabilities
    pub fn with_capabilities(
        node_id: String,
        ip_address: String,
        user_id: Option<String>,
        capabilities: ProviderCapabilities,
        assigned_limits: AssignedLimits,
    ) -> Self {
        let mut node = Self::new(node_id, ip_address, user_id);
        node.capabilities = capabilities;
        node.assigned_limits = assigned_limits.clone();
        node.max_connections = assigned_limits.max_connections;
        node.qos_tier = assigned_limits.qos_tier.clone();
        node
    }

    /// Calculate node score for selection (higher is better)
    /// P1-A6: Incorporates QoS tier, capabilities, and priority
    pub fn score(&self) -> u32 {
        if !self.is_healthy {
            return 0;
        }

        let mut score = 1000u32;

        // P1-A6: QoS tier bonus
        score += match self.qos_tier.as_str() {
            "premium" => 200,
            "standard" => 100,
            "basic" => 0,
            "limited" => -50i32 as u32, // Penalty for limited tier
            _ => 0,
        };

        // P1-A6: Priority bonus from assigned limits
        score += self.assigned_limits.priority as u32;

        // P1-A6: Bandwidth capacity bonus
        let bw_score = (self.capabilities.downlink_speed_kbps / 1000).min(100);
        score += bw_score;

        // Penalize high latency
        score = score.saturating_sub(self.latency_ms);

        // Penalize low connection capacity (connection count load)
        let load_percent = (self.active_connections * 100) / self.max_connections.max(1);
        score = score.saturating_sub(load_percent * 5); // 100% load = -500 score

        // Penalize high bandwidth usage
        let bw_penalty = self.bandwidth_rate_kbps / 100;
        score = score.saturating_sub(bw_penalty);

        // Bonus for fresh nodes (connected recently)
        let uptime_hours = (std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_else(|_| Duration::from_secs(0))
            .as_secs()
            - self.connected_at)
            / 3600;
        if uptime_hours < 24 {
            score += 50; // Fresh node bonus
        }

        score
    }
}

/// Provider registry with health tracking and intelligent selection
pub struct NodeRegistry {
    nodes: HashMap<String, (Control, NodeInfo)>,
    health_check_interval: Duration,
}

impl NodeRegistry {
    pub fn new() -> Self {
        Self {
            nodes: HashMap::new(),
            health_check_interval: Duration::from_secs(30),
        }
    }

    pub fn insert(&mut self, node_id: String, control: Control, info: NodeInfo) {
        println!(
            "Registered node: {} from {} ({})",
            node_id, info.region, info.country_code
        );
        self.nodes.insert(node_id, (control, info));
    }

    pub fn insert_simple(&mut self, node_id: String, control: Control, ip_address: String) {
        let info = NodeInfo::new(node_id.clone(), ip_address, None);
        self.insert(node_id, control, info);
    }

    pub fn remove(&mut self, node_id: &str) {
        if let Some((_, info)) = self.nodes.remove(node_id) {
            println!("Removed node: {} from {}", node_id, info.region);
        }
    }

    pub fn count(&self) -> usize {
        self.nodes.len()
    }

    pub fn get_node_info(&self, node_id: &str) -> Option<&NodeInfo> {
        self.nodes.get(node_id).map(|(_, info)| info)
    }

    /// Get a specific node by ID
    pub fn get_by_id(&self, node_id: &str) -> Option<Control> {
        if let Some((control, info)) = self.nodes.get(node_id) {
            if info.is_healthy {
                return Some(control.clone());
            }
        }
        None
    }

    pub fn update_node_stats(&mut self, node_id: &str, bytes_served: u64) {
        if let Some((_, info)) = self.nodes.get_mut(node_id) {
            info.total_bytes_served += bytes_served;
        }
    }

    pub fn update_active_connections(&mut self, node_id: &str, delta: i32) {
        if let Some((_, info)) = self.nodes.get_mut(node_id) {
            if delta > 0 {
                info.active_connections = info.active_connections.saturating_add(delta as u32);
            } else {
                info.active_connections = info.active_connections.saturating_sub((-delta) as u32);
            }
        }
    }

    pub fn mark_unhealthy(&mut self, node_id: &str) {
        if let Some((_, info)) = self.nodes.get_mut(node_id) {
            info.is_healthy = false;
            println!("Marked node {} as unhealthy", node_id);
        }
    }

    pub fn mark_healthy(&mut self, node_id: &str) {
        if let Some((_, info)) = self.nodes.get_mut(node_id) {
            info.is_healthy = true;
        }
    }

    /// Get a random healthy node
    pub fn get_random(&self) -> Option<Control> {
        let healthy_nodes: Vec<_> = self
            .nodes
            .iter()
            .filter(|(_, (_, info))| info.is_healthy)
            .collect();

        if let Some((_, (control, _))) = healthy_nodes.choose(&mut rand::thread_rng()) {
            Some(control.clone())
        } else {
            None
        }
    }

    /// Get the best node based on scoring
    pub fn get_best(&self) -> Option<(Control, String)> {
        let mut best: Option<(&String, &Control, u32)> = None;

        for (id, (control, info)) in &self.nodes {
            if !info.is_healthy {
                continue;
            }

            let score = info.score();
            if let Some((_, _, best_score)) = best {
                if score > best_score {
                    best = Some((id, control, score));
                }
            } else {
                best = Some((id, control, score));
            }
        }

        best.map(|(id, control, _)| (control.clone(), id.clone()))
    }

    /// Get nodes filtered by country
    pub fn get_by_country(&self, country_code: &str) -> Option<Control> {
        let matching: Vec<_> = self
            .nodes
            .iter()
            .filter(|(_, (_, info))| info.is_healthy && info.country_code == country_code)
            .collect();

        if let Some((_, (control, _))) = matching.choose(&mut rand::thread_rng()) {
            Some(control.clone())
        } else {
            None
        }
    }

    /// Get nodes filtered by region
    pub fn get_by_region(&self, region: &str) -> Option<Control> {
        let matching: Vec<_> = self
            .nodes
            .iter()
            .filter(|(_, (_, info))| {
                info.is_healthy && info.region.to_lowercase().contains(&region.to_lowercase())
            })
            .collect();

        if let Some((_, (control, _))) = matching.choose(&mut rand::thread_rng()) {
            Some(control.clone())
        } else {
            None
        }
    }

    /// Get node with least connections (load balancing)
    pub fn get_least_loaded(&self) -> Option<Control> {
        self.nodes
            .iter()
            .filter(|(_, (_, info))| {
                info.is_healthy && info.active_connections < info.max_connections
            })
            .min_by_key(|(_, (_, info))| info.active_connections)
            .map(|(_, (control, _))| control.clone())
    }

    /// List all nodes with their info
    pub fn list_nodes(&self) -> Vec<NodeInfo> {
        self.nodes.values().map(|(_, info)| info.clone()).collect()
    }
}

/// Selection strategy for routing requests
#[derive(Clone, Debug)]
pub enum SelectionStrategy {
    Random,
    Best,
    LeastLoaded,
    ByCountry(String),
    ByRegion(String),
}

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering as AtomicOrdering};

/// Per-session concurrency accounting (GW-03). Tracks live CONNECT tunnels per
/// resolved session username and rejects acquisitions beyond the session's
/// `max_concurrency` claim (0 = unlimited, tracked anyway for metrics).
pub struct SessionConnTracker {
    conns: dashmap::DashMap<String, Arc<AtomicUsize>>,
}

/// RAII guard — decrements the session's live-connection count on drop.
pub struct SessionConnGuard {
    key: String,
    counter: Arc<AtomicUsize>,
}

impl SessionConnGuard {
    pub fn active(&self) -> usize {
        self.counter.load(AtomicOrdering::Relaxed)
    }

    pub fn username(&self) -> &str {
        &self.key
    }
}

impl Drop for SessionConnGuard {
    fn drop(&mut self) {
        self.counter.fetch_sub(1, AtomicOrdering::Relaxed);
    }
}

impl SessionConnTracker {
    pub fn new() -> Self {
        Self {
            conns: dashmap::DashMap::new(),
        }
    }

    /// Try to register a new live connection for `username`.
    /// Returns None when the session is already at `max_concurrency` (> 0).
    pub fn acquire(&self, username: &str, max_concurrency: i32) -> Option<SessionConnGuard> {
        let counter = self
            .conns
            .entry(username.to_string())
            .or_insert_with(|| Arc::new(AtomicUsize::new(0)))
            .clone();

        if max_concurrency > 0 {
            // CAS loop: only increment while below the cap so racing CONNECTs
            // cannot overshoot it.
            loop {
                let current = counter.load(AtomicOrdering::Acquire);
                if current >= max_concurrency as usize {
                    return None;
                }
                if counter
                    .compare_exchange(
                        current,
                        current + 1,
                        AtomicOrdering::AcqRel,
                        AtomicOrdering::Acquire,
                    )
                    .is_ok()
                {
                    break;
                }
            }
        } else {
            counter.fetch_add(1, AtomicOrdering::Relaxed);
        }

        Some(SessionConnGuard {
            key: username.to_string(),
            counter,
        })
    }

    pub fn active(&self, username: &str) -> usize {
        self.conns
            .get(username)
            .map(|c| c.load(AtomicOrdering::Relaxed))
            .unwrap_or(0)
    }

    /// Number of sessions with at least one live connection.
    pub fn tracked_sessions(&self) -> usize {
        self.conns
            .iter()
            .filter(|e| e.value().load(AtomicOrdering::Relaxed) > 0)
            .count()
    }
}

impl Drop for SessionConnTracker {
    fn drop(&mut self) {
        self.conns.clear();
    }
}

pub struct AppState {
    /// Lock-free provider registry (Phase 1 upgrade from Mutex<NodeRegistry>).
    pub registry: Arc<LockFreeNodeRegistry>,
    pub config: Config,
    pub rate_limiter: Arc<RateLimiter<String, DefaultKeyedStateStore<String>, DefaultClock>>,
    pub is_leader: Arc<AtomicBool>,
    /// When true, `/health` and `/ready` fail and new buyer/tunnel accepts are rejected (P3 drain).
    pub draining: Arc<AtomicBool>,
    pub circuit_breakers: Arc<CircuitBreakerManager>,
    pub registry_store: Arc<crate::registry::store::RegistryStore>,
    /// P3: cross-pod provider ownership (`node_id` → `EDGE_POD_ID`).
    pub provider_directory: Arc<crate::registry::directory::ProviderDirectory>,
    pub usage_tracker: Arc<crate::metering::UsageTracker>,
    pub geoip: Option<Arc<maxminddb::Reader<Vec<u8>>>>,
    pub shaper: Arc<crate::qos::TrafficShaper>,
    pub heartbeat_store: crate::heartbeat::HeartbeatStore,
    /// In-memory heartbeat monitor — tracks per-node health and evicts stale nodes.
    pub heartbeat_monitor: Arc<crate::heartbeat::HeartbeatMonitor>,
    /// Per-node yamux stream pool (Phase 1 connection pooling).
    pub connection_pool: Arc<crate::pool::ConnectionPool>,
    // --- Phase 3: ML-based routing ---
    /// ML router with heuristic + optional ONNX backends (P3-W10).
    pub routing: Arc<crate::routing::ml_router::MLRouter>,
    /// Node feature cache for ML scoring (P3-W9).
    pub feature_cache: Arc<crate::routing::features::FeatureCache>,
    /// Predictive pre-warm engine (P3-W11).
    pub prewarm: Arc<crate::routing::prewarm::PrewarmEngine>,
    /// Rolling-window routing analytics (P3-W11).
    pub analytics: Arc<crate::routing::analytics::RoutingAnalytics>,
    /// A/B test coordinator for ML vs heuristic (P3-W10).
    pub ab_test: Arc<crate::routing::ab_test::AbTestCoordinator>,
    // --- Phase 4: Security & Production Hardening ---
    /// Adaptive per-IP DDoS rate limiter (P4-W13).
    pub ddos: Arc<crate::security::ddos::AdaptiveRateLimiter>,
    /// IP behavioral scorer (P4-W13).
    pub behavior: Arc<crate::security::ddos::BehaviorScorer>,
    /// Challenge token issuer (P4-W13).
    pub challenge: Arc<crate::security::ddos::ChallengeIssuer>,
    /// IP reputation store (P4-W13/W14).
    pub reputation: Arc<crate::security::reputation::IpReputationStore>,
    /// Geo-blocking list (P4-W13).
    pub geo_block: Arc<crate::security::reputation::GeoBlockList>,
    /// TLS/HTTP2 fingerprint database (P4-W14).
    pub fingerprint_db: Arc<crate::security::fingerprint::FingerprintDb>,
    /// Multi-region router (P4-W15).
    pub multiregion: Arc<crate::multiregion::routing::MultiRegionRouter>,
    /// Staged rollout plan (P4-W16).
    pub rollout: Arc<crate::rollout::RolloutPlan>,
    /// IP rotation manager — tracks per-session rotation state (W-01).
    pub rotation: Arc<Mutex<crate::rotation::RotationManager>>,
    /// Control API client for node registration and heartbeats
    pub control_api: Arc<crate::control_api::ControlApiClient>,
    /// Honeytoken registry for decoy detection (Phase 4).
    pub honeytoken: Arc<crate::security::honeytoken::HoneytokenRegistry>,
    /// Anomaly tracker for session monitoring (Phase 4).
    pub anomaly: Arc<crate::security::anomaly::AnomalyTracker>,
    /// Per-session live-connection accounting for max_concurrency enforcement (GW-03).
    pub session_conns: Arc<SessionConnTracker>,
    /// Legacy edge-side ZK-SNARK usage prover (`legacy-zk` feature + env opt-in).
    #[cfg(feature = "legacy-zk")]
    pub zk_prover: Option<Arc<crate::billing::zk::ZkProver>>,
    /// Solana transaction relayer for decentralized payouts (`legacy-zk` feature).
    #[cfg(feature = "legacy-zk")]
    pub solana_relayer: Arc<crate::billing::solana::SolanaRelayer>,
    /// Legacy batch relayer for edge-side settlement experiments (`legacy-zk` feature).
    #[cfg(feature = "legacy-zk")]
    pub solana_batch_relayer: Option<Arc<crate::billing::solana::BatchRelayer>>,
}

impl AppState {
    pub fn new(
        config: Config,
        is_leader: Arc<AtomicBool>,
        registry_store: Arc<crate::registry::store::RegistryStore>,
        provider_directory: Arc<crate::registry::directory::ProviderDirectory>,
        usage_tracker: Arc<crate::metering::UsageTracker>,
    ) -> Self {
        // ... (geoip initialization already implemented)

        // Initialize Traffic Shaper (Default 10MB/s quota)
        let shaper = Arc::new(crate::qos::TrafficShaper::new(10 * 1024 * 1024));
        // Load GeoIP if path provided
        let geoip = config.geoip_db_path.as_ref().and_then(|path| {
            match maxminddb::Reader::open_readfile(path) {
                Ok(reader) => {
                    println!("[GeoIP] Loaded database from {}", path);
                    Some(Arc::new(reader))
                }
                Err(e) => {
                    eprintln!("[GeoIP] FAILED to load database: {}", e);
                    None
                }
            }
        });
        // Rate limit: 10 connections per second per user (adjust as needed)
        // Using expect() because these constants are guaranteed to be non-zero
        let quota = Quota::per_second(NonZeroU32::new(10).expect("non-zero quota"))
            .allow_burst(NonZeroU32::new(20).expect("non-zero burst"));
        let rate_limiter = Arc::new(RateLimiter::keyed(quota));

        // Initialize heartbeat store
        let heartbeat_store = crate::heartbeat::HeartbeatStore::new(registry_store.client());

        // Initialize heartbeat monitor and start background check task
        let heartbeat_monitor = Arc::new(crate::heartbeat::HeartbeatMonitor::new(
            crate::heartbeat::HeartbeatConfig::default(),
        ));

        let connection_pool = crate::pool::ConnectionPool::new(crate::pool::PoolConfig::default());

        // Phase 3: ML routing components
        let feature_cache = Arc::new(crate::routing::features::FeatureCache::new());
        let routing = Arc::new(crate::routing::ml_router::MLRouter::new(
            feature_cache.clone(),
        ));
        let prewarm = Arc::new(crate::routing::prewarm::PrewarmEngine::new(
            std::time::Duration::from_secs(60),
        ));
        let analytics = Arc::new(crate::routing::analytics::RoutingAnalytics::new(0.0));
        let ab_test = Arc::new(crate::routing::ab_test::AbTestCoordinator::new(0.0));

        // Phase 4: Security & Production Hardening
        let ddos = Arc::new(crate::security::ddos::AdaptiveRateLimiter::new(
            crate::security::ddos::RateLimitConfig::default(),
        ));
        let behavior = Arc::new(crate::security::ddos::BehaviorScorer::new(
            Duration::from_secs(300),
        ));
        let challenge = Arc::new(crate::security::ddos::ChallengeIssuer::new(
            Duration::from_secs(30),
        ));
        let reputation = Arc::new(crate::security::reputation::IpReputationStore::new(
            Duration::from_secs(86400), // 24-hour TTL
        ));
        let geo_block = Arc::new(crate::security::reputation::GeoBlockList::new(
            config.geo_deny_list.iter().cloned(),
            config.geo_allow_list.iter().cloned(),
            geoip.clone(),
        ));
        let fingerprint_db = Arc::new(crate::security::fingerprint::FingerprintDb::new());
        let multiregion = Arc::new(crate::multiregion::routing::MultiRegionRouter::new(
            config
                .region
                .clone()
                .unwrap_or_else(|| "default".to_string()),
        ));
        let rollout = Arc::new(crate::rollout::RolloutPlan::new());

        // Initialize Control API client for node registration
        let control_api = Arc::new(crate::control_api::ControlApiClient::new(
            &config.control_api_url,
            &config.gateway_shared_secret,
        ));
        let honeytoken = Arc::new(crate::security::honeytoken::HoneytokenRegistry::new());
        let anomaly = Arc::new(crate::security::anomaly::AnomalyTracker::new(
            config.max_rpm_per_session.unwrap_or(300),
        ));
        #[cfg(feature = "legacy-zk")]
        let zk_prover = if config.legacy_edge_zk_submission_enabled {
            Some(Arc::new(crate::billing::zk::ZkProver::new()))
        } else {
            None
        };
        #[cfg(feature = "legacy-zk")]
        let solana_program_id = env::var("SOLANA_PROGRAM_ID")
            .or_else(|_| env::var("REPUTATION_PROGRAM_ID"))
            .unwrap_or_default();
        #[cfg(feature = "legacy-zk")]
        let solana_relayer = Arc::new(crate::billing::solana::SolanaRelayer::new(
            &solana_program_id,
            &env::var("SOLANA_RPC_URL")
                .unwrap_or_else(|_| "https://api.devnet.solana.com".to_string()),
        ));
        #[cfg(feature = "legacy-zk")]
        let solana_batch_relayer = if config.legacy_edge_zk_submission_enabled {
            Some(Arc::new(crate::billing::solana::BatchRelayer::new(
                solana_relayer.clone(),
                10,
            )))
        } else {
            None
        };

        Self {
            registry: Arc::new(LockFreeNodeRegistry::new()),
            config,
            rate_limiter,
            is_leader,
            draining: Arc::new(AtomicBool::new(false)),
            circuit_breakers: Arc::new(CircuitBreakerManager::new()),
            registry_store,
            provider_directory,
            usage_tracker,
            geoip,
            shaper,
            heartbeat_store,
            heartbeat_monitor,
            connection_pool,
            routing,
            feature_cache,
            prewarm,
            analytics,
            ab_test,
            ddos,
            behavior,
            challenge,
            reputation,
            geo_block,
            fingerprint_db,
            multiregion,
            rollout,
            rotation: Arc::new(Mutex::new(crate::rotation::RotationManager::new())),
            control_api,
            honeytoken,
            anomaly,
            session_conns: Arc::new(SessionConnTracker::new()),
            #[cfg(feature = "legacy-zk")]
            zk_prover,
            #[cfg(feature = "legacy-zk")]
            solana_relayer,
            #[cfg(feature = "legacy-zk")]
            solana_batch_relayer,
        }
    }

    /// Check if a user is within rate limits
    pub fn check_rate_limit(&self, key: &str) -> bool {
        self.rate_limiter.check_key(&key.to_string()).is_ok()
    }

    /// Select a provider using the ML router (Phase 3).
    ///
    /// Picks a backend via the A/B coordinator, scores all healthy nodes, records
    /// the decision in the rolling analytics window, and falls back to the
    /// heuristic `registry.get_best()` if no candidates are found.
    pub fn select_provider_ml(&self, target_domain: Option<&str>) -> Option<(Control, String)> {
        let backend = self.ab_test.choose_backend();
        let timer = crate::routing::analytics::RoutingAnalytics::start_timer();
        let result = self.routing.select(&self.registry, backend, target_domain);
        if let Some((_, ref node_id)) = result {
            let decision = crate::routing::analytics::RoutingAnalytics::finish(
                timer,
                backend,
                node_id.clone(),
                true, // optimistic; caller updates to false on connection failure
            );
            self.analytics.record(decision);
        }
        result.or_else(|| self.registry.get_best())
    }

    /// Select a provider based on strategy (no lock needed — registry is lock-free)
    pub fn select_provider(&self, strategy: SelectionStrategy) -> Option<Control> {
        match strategy {
            SelectionStrategy::Random => self.registry.get_random(),
            SelectionStrategy::Best => self.registry.get_best().map(|(c, _)| c),
            SelectionStrategy::LeastLoaded => self.registry.get_least_loaded(),
            SelectionStrategy::ByCountry(code) => self
                .registry
                .get_by_country(&code)
                .or_else(|| self.registry.get_random()),
            SelectionStrategy::ByRegion(region) => self
                .registry
                .get_by_region(&region)
                .or_else(|| self.registry.get_random()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_conn_tracker_enforces_cap() {
        let tracker = SessionConnTracker::new();
        let g1 = tracker.acquire("sess-a", 2).expect("first allowed");
        let _g2 = tracker.acquire("sess-a", 2).expect("second allowed");
        assert!(tracker.acquire("sess-a", 2).is_none(), "third must be rejected at cap 2");
        assert_eq!(tracker.active("sess-a"), 2);
        assert_eq!(g1.active(), 2);
        drop(g1);
        assert_eq!(tracker.active("sess-a"), 1);
        assert!(tracker.acquire("sess-a", 2).is_some(), "slot freed after guard drop");
    }

    #[test]
    fn session_conn_tracker_unlimited_when_zero_cap() {
        let tracker = SessionConnTracker::new();
        let mut guards = Vec::new();
        for _ in 0..100 {
            guards.push(tracker.acquire("sess-b", 0).expect("unlimited"));
        }
        assert_eq!(tracker.active("sess-b"), 100);
        drop(guards);
        assert_eq!(tracker.active("sess-b"), 0);
    }

    #[test]
    fn session_conn_tracker_isolates_sessions() {
        let tracker = SessionConnTracker::new();
        let _a = tracker.acquire("sess-x", 1).expect("x allowed");
        assert!(tracker.acquire("sess-x", 1).is_none());
        let _b = tracker
            .acquire("sess-y", 1)
            .expect("other session unaffected");
        assert_eq!(tracker.tracked_sessions(), 2);
    }

    fn create_test_node(id: &str, latency: u32, active: u32, max: u32, healthy: bool) -> NodeInfo {
        NodeInfo {
            node_id: id.to_string(),
            user_id: None,
            country_code: "GH".to_string(),
            region: "Accra".to_string(),
            isp: String::new(),
            ip_address: "192.168.1.1".to_string(),
            connected_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
            total_bytes_served: 0,
            active_connections: active,
            max_connections: max,
            latency_ms: latency,
            bandwidth_rate_kbps: 0,
            is_healthy: healthy,
            // P1-A6: Initialize test nodes with default capabilities
            capabilities: ProviderCapabilities::default(),
            assigned_limits: AssignedLimits {
                max_connections: max,
                bandwidth_cap_mbps: 100,
                allowed_ports: vec![80, 443],
                qos_tier: "basic".to_string(),
                priority: 50,
            },
            qos_tier: "basic".to_string(),
            current_tier: "Bronze".to_string(),
            quality_score: 100.0,
            base_price_per_gb: 0.20,
            lease_expires_at: 0,
            control_api_db_id: None,
            provider_run_id: String::new(),
        }
    }

    #[test]
    fn test_node_score_healthy() {
        let node = create_test_node("node-1", 50, 0, 100, true);
        let score = node.score();
        assert!(score > 900);
    }

    #[test]
    fn test_node_score_unhealthy() {
        let node = create_test_node("node-2", 50, 0, 100, false);
        let score = node.score();
        assert_eq!(score, 0);
    }

    #[test]
    fn test_node_score_high_latency() {
        let low_latency = create_test_node("node-low", 20, 0, 100, true);
        let high_latency = create_test_node("node-high", 200, 0, 100, true);
        assert!(low_latency.score() > high_latency.score());
    }

    #[test]
    fn test_node_score_high_load() {
        let low_load = create_test_node("node-low", 50, 10, 100, true);
        let high_load = create_test_node("node-high", 50, 80, 100, true);
        assert!(low_load.score() > high_load.score());
    }

    #[test]
    fn test_node_info_creation() {
        let node = NodeInfo::new("test-node".to_string(), "10.0.0.1".to_string(), None);
        assert_eq!(node.node_id, "test-node");
        assert_eq!(node.ip_address, "10.0.0.1");
        assert!(node.is_healthy);
    }
}

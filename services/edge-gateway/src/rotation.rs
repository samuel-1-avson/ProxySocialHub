// Rotation Strategies for IP rotation in the proxy system
// Supports: time-based, request-based, smart (on error), and hybrid strategies

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

/// Rotation strategy configuration
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RotationConfig {
    pub strategy: RotationStrategy,
    pub time_interval_secs: u64, // For time-based rotation
    pub request_count: u64,      // For request-based rotation
    pub error_codes: Vec<u16>,   // HTTP codes that trigger smart rotation (403, 429, etc)
    pub max_failures_before_rotate: u32,
    pub cooldown_secs: u64, // Cooldown before reusing a rotated node
}

impl Default for RotationConfig {
    fn default() -> Self {
        Self {
            strategy: RotationStrategy::Smart,
            time_interval_secs: 300, // 5 minutes
            request_count: 100,
            error_codes: vec![403, 429, 503], // Forbidden, Rate limited, Service unavailable
            max_failures_before_rotate: 3,
            cooldown_secs: 60,
        }
    }
}

/// Build a RotationConfig from session-intent / Redis session JWT claims.
pub fn config_from_session_claims(rotation_type: &str, interval_secs: u32) -> RotationConfig {
    let mut cfg = RotationConfig::default();
    let t = rotation_type.trim().to_ascii_lowercase();
    cfg.strategy = match t.as_str() {
        "none" | "sticky" => RotationStrategy::None,
        "per-request" | "request" | "request-based" | "request_based" => {
            RotationStrategy::RequestBased
        }
        "time-based" | "time" | "time_based" | "interval" => RotationStrategy::TimeBased,
        "hybrid" => RotationStrategy::Hybrid,
        "smart" => RotationStrategy::Smart,
        // Empty / unknown: keep Smart default for rotating sessions.
        _ => RotationStrategy::Smart,
    };
    if interval_secs > 0 {
        cfg.time_interval_secs = u64::from(interval_secs);
    }
    cfg
}

/// Available rotation strategies
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RotationStrategy {
    /// No rotation - sticky session
    None,
    /// Rotate after a fixed time interval
    TimeBased,
    /// Rotate after N requests
    RequestBased,
    /// Rotate on specific HTTP error codes (403, 429, etc)
    Smart,
    /// Combine time and smart rotation
    Hybrid,
}

/// Session rotation state tracking
pub struct RotationState {
    pub session_id: String,
    pub current_node_id: Option<String>,
    pub node_assigned_at: Instant,
    pub request_count: AtomicU64,
    pub failure_count: AtomicU64,
    pub last_failure_code: Option<u16>,
    pub rotated_nodes: Vec<(String, Instant)>, // (node_id, cooldown_until)
    pub config: RotationConfig,
}

impl RotationState {
    pub fn new(session_id: String, config: RotationConfig) -> Self {
        Self {
            session_id,
            current_node_id: None,
            node_assigned_at: Instant::now(),
            request_count: AtomicU64::new(0),
            failure_count: AtomicU64::new(0),
            last_failure_code: None,
            rotated_nodes: Vec::new(),
            config,
        }
    }

    /// Check if rotation is needed based on current strategy
    pub fn should_rotate(&self) -> bool {
        match self.config.strategy {
            RotationStrategy::None => false,
            RotationStrategy::TimeBased => self.should_rotate_time(),
            RotationStrategy::RequestBased => self.should_rotate_request(),
            RotationStrategy::Smart => self.should_rotate_smart(),
            RotationStrategy::Hybrid => self.should_rotate_time() || self.should_rotate_smart(),
        }
    }

    fn should_rotate_time(&self) -> bool {
        self.node_assigned_at.elapsed() >= Duration::from_secs(self.config.time_interval_secs)
    }

    fn should_rotate_request(&self) -> bool {
        self.request_count.load(Ordering::Relaxed) >= self.config.request_count
    }

    fn should_rotate_smart(&self) -> bool {
        self.failure_count.load(Ordering::Relaxed) >= self.config.max_failures_before_rotate as u64
    }

    /// Record a request and check for rotation triggers
    pub fn record_request(&self) -> u64 {
        self.request_count.fetch_add(1, Ordering::Relaxed) + 1
    }

    /// Record a failure and check if it's a rotation-triggering error
    pub fn record_failure(&mut self, http_code: u16) -> bool {
        self.last_failure_code = Some(http_code);

        if self.config.error_codes.contains(&http_code) {
            self.failure_count.fetch_add(1, Ordering::Relaxed);
            return self.should_rotate_smart();
        }
        false
    }

    /// Record a successful request (resets failure count)
    pub fn record_success(&self) {
        self.failure_count.store(0, Ordering::Relaxed);
    }

    /// Assign a new node and reset counters
    pub fn assign_node(&mut self, node_id: String) {
        // Move old node to cooldown
        if let Some(old_node) = self.current_node_id.take() {
            let cooldown_until = Instant::now() + Duration::from_secs(self.config.cooldown_secs);
            self.rotated_nodes.push((old_node, cooldown_until));

            // Clean up expired cooldowns
            self.rotated_nodes
                .retain(|(_, until)| *until > Instant::now());
        }

        self.current_node_id = Some(node_id);
        self.node_assigned_at = Instant::now();
        self.request_count.store(0, Ordering::Relaxed);
        self.failure_count.store(0, Ordering::Relaxed);
        self.last_failure_code = None;
    }

    /// Check if a node is in cooldown
    pub fn is_node_in_cooldown(&self, node_id: &str) -> bool {
        self.rotated_nodes
            .iter()
            .any(|(id, until)| id == node_id && *until > Instant::now())
    }

    /// Get rotation stats for logging/monitoring
    pub fn get_stats(&self) -> RotationStats {
        RotationStats {
            session_id: self.session_id.clone(),
            current_node: self.current_node_id.clone(),
            request_count: self.request_count.load(Ordering::Relaxed),
            failure_count: self.failure_count.load(Ordering::Relaxed),
            nodes_rotated: self.rotated_nodes.len() as u32,
            last_failure_code: self.last_failure_code,
            time_on_current_node_secs: self.node_assigned_at.elapsed().as_secs(),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct RotationStats {
    pub session_id: String,
    pub current_node: Option<String>,
    pub request_count: u64,
    pub failure_count: u64,
    pub nodes_rotated: u32,
    pub last_failure_code: Option<u16>,
    pub time_on_current_node_secs: u64,
}

/// Session rotation manager for all active sessions
pub struct RotationManager {
    sessions: HashMap<String, RotationState>,
    default_config: RotationConfig,
}

impl RotationManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            default_config: RotationConfig::default(),
        }
    }

    pub fn with_config(config: RotationConfig) -> Self {
        Self {
            sessions: HashMap::new(),
            default_config: config,
        }
    }

    /// Create or get rotation state for a session
    pub fn get_or_create(&mut self, session_id: &str) -> &mut RotationState {
        self.sessions
            .entry(session_id.to_string())
            .or_insert_with(|| {
                RotationState::new(session_id.to_string(), self.default_config.clone())
            })
    }

    /// Create session with custom config
    pub fn create_with_config(
        &mut self,
        session_id: &str,
        config: RotationConfig,
    ) -> &mut RotationState {
        self.sessions
            .entry(session_id.to_string())
            .and_modify(|s| s.config = config.clone())
            .or_insert_with(|| RotationState::new(session_id.to_string(), config))
    }

    /// Remove session
    pub fn remove(&mut self, session_id: &str) {
        self.sessions.remove(session_id);
    }

    /// Get session state
    pub fn get(&self, session_id: &str) -> Option<&RotationState> {
        self.sessions.get(session_id)
    }

    /// Get mutable session state
    pub fn get_mut(&mut self, session_id: &str) -> Option<&mut RotationState> {
        self.sessions.get_mut(session_id)
    }

    /// Get all session stats
    pub fn get_all_stats(&self) -> Vec<RotationStats> {
        self.sessions.values().map(|s| s.get_stats()).collect()
    }

    /// Clean up expired sessions (no activity for 1 hour)
    pub fn cleanup(&mut self) {
        let hour = Duration::from_secs(3600);
        self.sessions
            .retain(|_, state| state.node_assigned_at.elapsed() < hour);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_time_based_rotation() {
        let config = RotationConfig {
            strategy: RotationStrategy::TimeBased,
            time_interval_secs: 0, // Immediate rotation for testing
            ..Default::default()
        };

        let state = RotationState::new("test".to_string(), config);
        assert!(state.should_rotate());
    }

    #[test]
    fn test_request_based_rotation() {
        let config = RotationConfig {
            strategy: RotationStrategy::RequestBased,
            request_count: 3,
            ..Default::default()
        };

        let state = RotationState::new("test".to_string(), config);
        assert!(!state.should_rotate());

        state.record_request();
        state.record_request();
        assert!(!state.should_rotate());

        state.record_request();
        assert!(state.should_rotate());
    }

    #[test]
    fn test_smart_rotation() {
        let config = RotationConfig {
            strategy: RotationStrategy::Smart,
            max_failures_before_rotate: 2,
            error_codes: vec![403, 429],
            ..Default::default()
        };

        let mut state = RotationState::new("test".to_string(), config);

        // Non-triggering error
        assert!(!state.record_failure(500));

        // Triggering errors
        assert!(!state.record_failure(403));
        assert!(state.record_failure(429)); // 2nd failure triggers
    }

    #[test]
    fn test_config_from_session_claims() {
        let none = config_from_session_claims("none", 0);
        assert_eq!(none.strategy, RotationStrategy::None);

        let per_req = config_from_session_claims("per-request", 0);
        assert_eq!(per_req.strategy, RotationStrategy::RequestBased);

        let timed = config_from_session_claims("time-based", 120);
        assert_eq!(timed.strategy, RotationStrategy::TimeBased);
        assert_eq!(timed.time_interval_secs, 120);

        let hybrid = config_from_session_claims("hybrid", 60);
        assert_eq!(hybrid.strategy, RotationStrategy::Hybrid);
        assert_eq!(hybrid.time_interval_secs, 60);

        let smart = config_from_session_claims("smart", 0);
        assert_eq!(smart.strategy, RotationStrategy::Smart);

        let unknown = config_from_session_claims("", 0);
        assert_eq!(unknown.strategy, RotationStrategy::Smart);
    }
}

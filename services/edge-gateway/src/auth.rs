pub mod provider_lease;
pub mod session_intent;

mod redis_keys {
    /// Pre-sized Redis keys (one allocation, no `format!` macro).

    pub fn session(username: &str) -> String {
        let mut key = String::with_capacity(8 + username.len());
        key.push_str("session:");
        key.push_str(username);
        key
    }

    pub fn session_usage(username: &str) -> String {
        let mut key = String::with_capacity(14 + username.len());
        key.push_str("session:");
        key.push_str(username);
        key.push_str(":usage");
        key
    }

    pub fn sticky(session_id: &str) -> String {
        let mut key = String::with_capacity(7 + session_id.len());
        key.push_str("sticky:");
        key.push_str(session_id);
        key
    }

    pub fn ratelimit(session_id: &str) -> String {
        let mut key = String::with_capacity(10 + session_id.len());
        key.push_str("ratelimit:");
        key.push_str(session_id);
        key
    }

    pub fn node_config(node_id: &str) -> String {
        let mut key = String::with_capacity(12 + node_id.len());
        key.push_str("node:config:");
        key.push_str(node_id);
        key
    }

    pub fn intent_username(jti: &str) -> String {
        let mut key = String::with_capacity(7 + jti.len());
        key.push_str("intent:");
        key.push_str(jti);
        key
    }
}

use crate::metrics;
use crate::redis_pool::PooledConnectionManager;
use chrono::{DateTime, Utc};
use moka::future::Cache;
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use std::error::Error;
use std::time::Duration;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProxyAuthSource {
    LegacySession,
    SessionIntent,
}

#[derive(Debug, Clone)]
pub struct ResolvedProxySession {
    pub username: String,
    pub session: SessionData,
    pub source: ProxyAuthSource,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SessionData {
    pub user_id: String,
    pub session_id: String,
    #[serde(default)]
    pub provider_id: String,
    #[serde(rename = "type")]
    pub session_type: String,
    pub status: String,
    pub bandwidth_limit: i64,
    pub bandwidth_used: i64,
    #[serde(default)]
    pub trust_tier: String,
    #[serde(default)]
    pub target_geo: String,
    #[serde(default)]
    pub target_isp: String,

    // N-02: Per-session access control & rotation config from session_configurations
    #[serde(default)]
    pub allowed_domains: Vec<String>,
    #[serde(default)]
    pub blocked_domains: Vec<String>,
    #[serde(default)]
    pub rotation_type: String,
    #[serde(default)]
    pub rotation_interval_seconds: u32,
    #[serde(default)]
    pub time_limit_minutes: u32,
    #[serde(default)]
    pub created_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub expires_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub auth_source: String,
    #[serde(default)]
    pub intent_expires_at: i64,

    // P2P marketplace listing fields (control-api session sync)
    #[serde(default)]
    pub listing_id: String,
    #[serde(default)]
    pub node_id: String,
    #[serde(default)]
    pub node_host: String,
    #[serde(default)]
    pub node_port: i32,
    #[serde(default)]
    pub price_per_gb: f64,
    #[serde(default)]
    pub credential_password_hash: String,
}

fn verify_credential_password(expected_hex: &str, password: &str) -> bool {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(password.as_bytes());
    let computed = hex::encode(hasher.finalize());
    constant_time_eq(computed.as_bytes(), expected_hex.as_bytes())
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

pub struct SessionAuthenticator {
    // P1-A4: Redis connection pool for better concurrency and performance
    conn_pool: PooledConnectionManager,
    /// P1: Sharded async session cache (lock-free reads, TTL-native eviction).
    cache: Cache<String, SessionData>,
    cache_ttl: Duration,
    cache_max_size: usize,
}

impl SessionAuthenticator {
    /// P0-A2 + P1-A4: Create new authenticator with configurable cache and connection pool
    pub async fn new(
        redis_url: &str,
        cache_size: usize,
        cache_ttl_secs: u64,
    ) -> Result<Self, Box<dyn Error + Send + Sync>> {
        // P1-A4: Use connection pool instead of single ConnectionManager
        let conn_pool = PooledConnectionManager::new(redis_url, 32).await?;

        // Ensure cache_size is at least 1
        let effective_size = cache_size.max(1);
        let cache_ttl = Duration::from_secs(cache_ttl_secs.max(1));

        let authenticator = Self {
            conn_pool,
            cache: Cache::builder()
                .max_capacity(effective_size as u64)
                .time_to_live(cache_ttl)
                .build(),
            cache_ttl,
            cache_max_size: effective_size,
        };

        // Start background task to report cache metrics
        authenticator.start_metrics_task();

        Ok(authenticator)
    }

    /// P0-A2: Start background task to periodically report cache metrics
    fn start_metrics_task(&self) {
        let cache = self.cache.clone();
        tokio::spawn(async move {
            // Wait 10 seconds before first report
            tokio::time::sleep(Duration::from_secs(10)).await;

            let mut interval = tokio::time::interval(Duration::from_secs(10));

            loop {
                interval.tick().await;
                metrics::set_session_cache_size(cache.entry_count() as i64);
            }
        });
    }

    /// Validate session and return session data if valid
    /// P0-A2: Tracks cache hit/miss metrics for observability
    pub async fn validate_session(
        &self,
        username: &str,
        force_refresh: bool,
    ) -> Result<Option<SessionData>, Box<dyn Error + Send + Sync>> {
        // Check cache first
        if !force_refresh {
            if let Some(session_data) = self.cache.get(username).await {
                metrics::record_session_cache_hit();
                return Ok(Some(session_data));
            }
            metrics::record_session_cache_miss();
        } else {
            // Forced refresh counts as cache miss
            metrics::record_session_cache_miss();
        }

        // Fetch from Redis
        let mut con = self.conn_pool.get().await?;
        let key = redis_keys::session(username);
        let data: Option<String> = con.get(&key).await?;

        match data {
            Some(json_str) => {
                let session_data: SessionData = serde_json::from_str(&json_str)?;

                // Check if session is active
                if session_data.status != "active" {
                    return Ok(None);
                }

                // A non-positive bandwidth limit means unlimited. Positive limits are hard caps.
                if !session_data.has_remaining_bandwidth() {
                    return Ok(None);
                }

                if !session_data.session_within_time_limit() {
                    return Ok(None);
                }

                self.cache
                    .insert(username.to_string(), session_data.clone())
                    .await;

                Ok(Some(session_data))
            }
            None => Ok(None),
        }
    }

    pub async fn resolve_proxy_auth(
        &self,
        username: &str,
        password: &str,
        intent_secret: &str,
    ) -> Result<Option<ResolvedProxySession>, Box<dyn Error + Send + Sync>> {
        if is_session_intent_username(username) {
            let claims = session_intent::SessionIntentValidator::new(intent_secret)
                .validate(password)
                .map_err(|err| -> Box<dyn Error + Send + Sync> {
                    Box::new(std::io::Error::new(
                        std::io::ErrorKind::PermissionDenied,
                        err.to_string(),
                    ))
                })?;

            let resolved_username = redis_keys::intent_username(&claims.jti);
            let session_data = SessionData::from_session_intent(&claims);

            self.cache
                .insert(resolved_username.clone(), session_data.clone())
                .await;

            return Ok(Some(ResolvedProxySession {
                username: resolved_username,
                session: session_data,
                source: ProxyAuthSource::SessionIntent,
            }));
        }

        let session = match self.validate_session(username, false).await? {
            Some(session) => session,
            None => return Ok(None),
        };

        if !session.legacy_credentials_match(password) {
            return Ok(None);
        }

        Ok(Some(ResolvedProxySession {
            username: username.to_string(),
            session,
            source: ProxyAuthSource::LegacySession,
        }))
    }

    /// Report usage for a session
    pub async fn report_usage(
        &self,
        username: &str,
        bytes: i64,
    ) -> Result<(), Box<dyn Error + Send + Sync>> {
        let mut con = self.conn_pool.get().await?;
        let key = redis_keys::session_usage(username);
        let _: () = con.incr(&key, bytes).await?;
        Ok(())
    }

    /// Invalidate cached session
    pub async fn invalidate_cache(&self, username: &str) {
        if self.cache.contains_key(username) {
            self.cache.invalidate(username).await;
            metrics::record_session_cache_eviction();
        }
    }

    /// Lightweight Redis liveness check for `/ready`.
    pub async fn ping(&self) -> bool {
        match self.conn_pool.get().await {
            Ok(mut con) => redis::cmd("PING")
                .query_async(&mut con)
                .await
                .map(|pong: String| pong == "PONG")
                .unwrap_or(false),
            Err(_) => false,
        }
    }

    /// P0-A2: Get cache statistics for monitoring
    pub async fn get_cache_stats(&self) -> CacheStats {
        CacheStats {
            size: self.cache.entry_count() as usize,
            max_size: self.cache_max_size,
            ttl_secs: self.cache_ttl.as_secs(),
        }
    }

    // ========== Sticky Session Methods ==========

    /// Get the sticky node binding for a session
    /// Returns Some(node_id) if session is bound, None otherwise
    pub async fn get_sticky_node(
        &self,
        session_id: &str,
    ) -> Result<Option<String>, Box<dyn Error + Send + Sync>> {
        let mut con = self.conn_pool.get().await?;
        let key = redis_keys::sticky(session_id);
        let node_id: Option<String> = con.get(&key).await?;
        Ok(node_id)
    }

    /// Bind a session to a specific node (for sticky sessions)
    pub async fn set_sticky_node(
        &self,
        session_id: &str,
        node_id: &str,
        ttl_secs: u64,
    ) -> Result<(), Box<dyn Error + Send + Sync>> {
        let mut con = self.conn_pool.get().await?;
        let key = redis_keys::sticky(session_id);
        let _: () = con.set_ex(&key, node_id, ttl_secs).await?;
        Ok(())
    }

    /// Remove sticky binding (e.g., when session terminates)
    pub async fn remove_sticky_node(
        &self,
        session_id: &str,
    ) -> Result<(), Box<dyn Error + Send + Sync>> {
        let mut con = self.conn_pool.get().await?;
        let key = redis_keys::sticky(session_id);
        let _: () = con.del(&key).await?;
        Ok(())
    }

    // ========== Rate Limiting Methods ==========

    /// Check and increment rate limit counter
    /// Returns Ok(true) if allowed, Ok(false) if rate limited
    pub async fn check_rate_limit(
        &self,
        session_id: &str,
        limit_per_minute: u32,
    ) -> Result<bool, Box<dyn Error + Send + Sync>> {
        let mut con = self.conn_pool.get().await?;
        let key = redis_keys::ratelimit(session_id);

        // INCR the counter
        let count: i64 = con.incr(&key, 1).await?;

        // Set expiry on first request (60 seconds window)
        if count == 1 {
            let _: () = con.expire(&key, 60).await?;
        }

        Ok(count <= limit_per_minute as i64)
    }

    /// Get current request count for a session
    pub async fn get_request_count(
        &self,
        session_id: &str,
    ) -> Result<u32, Box<dyn Error + Send + Sync>> {
        let mut con = self.conn_pool.get().await?;
        let key = redis_keys::ratelimit(session_id);
        let count: Option<u32> = con.get(&key).await?;
        Ok(count.unwrap_or(0))
    }

    /// Fetch cached node service configuration (N-01)
    pub async fn get_node_config(&self, node_id: &str) -> Option<NodeConfig> {
        let mut con = self.conn_pool.get().await.ok()?;
        let key = redis_keys::node_config(node_id);
        let json_str: Option<String> = redis::AsyncCommands::get(&mut con, &key).await.ok()?;
        let cfg: NodeConfig = serde_json::from_str(&json_str?).ok()?;
        Some(cfg)
    }
}

impl SessionData {
    pub fn from_session_intent(claims: &session_intent::SessionIntentClaims) -> Self {
        Self {
            user_id: claims.sub.clone(),
            session_id: claims.jti.clone(),
            provider_id: String::new(),
            session_type: claims.session_type.clone(),
            status: "active".to_string(),
            bandwidth_limit: claims.bandwidth_limit,
            bandwidth_used: 0,
            trust_tier: claims.trust_tier.clone(),
            target_geo: claims.target_geo.clone(),
            target_isp: claims.target_isp.clone(),
            allowed_domains: claims.allowed_domains.clone(),
            blocked_domains: claims.blocked_domains.clone(),
            rotation_type: claims.rotation_type.clone(),
            rotation_interval_seconds: claims.rotation_interval_seconds.max(0) as u32,
            time_limit_minutes: claims.time_limit_minutes.max(0) as u32,
            auth_source: "session_intent".to_string(),
            intent_expires_at: claims.exp as i64,
            ..Default::default()
        }
    }

    pub fn is_session_intent(&self) -> bool {
        self.auth_source == "session_intent"
    }

    pub fn has_remaining_bandwidth(&self) -> bool {
        self.bandwidth_limit <= 0 || self.bandwidth_used < self.bandwidth_limit
    }

    fn legacy_credentials_match(&self, password: &str) -> bool {
        !self.credential_password_hash.trim().is_empty()
            && verify_credential_password(&self.credential_password_hash, password)
    }

    pub fn intent_still_valid(&self) -> bool {
        if !self.is_session_intent() || self.intent_expires_at <= 0 {
            return true;
        }

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or_default();
        now <= self.intent_expires_at
    }

    /// P2: Enforce Redis `expires_at`, `created_at` + `time_limit_minutes`, and intent JWT expiry.
    pub fn session_within_time_limit(&self) -> bool {
        let now = Utc::now();

        if self.is_session_intent() && !self.intent_still_valid() {
            return false;
        }

        if let Some(expires_at) = self.expires_at {
            if now > expires_at {
                return false;
            }
        }

        if self.time_limit_minutes > 0 {
            if let Some(created_at) = self.created_at {
                let limit = chrono::Duration::minutes(i64::from(self.time_limit_minutes.max(1)));
                if now > created_at + limit {
                    return false;
                }
            }
        }

        true
    }
}

pub async fn revalidate_live_session(
    authenticator: &SessionAuthenticator,
    username: &str,
    session: &SessionData,
) -> bool {
    if !session.session_within_time_limit() {
        return false;
    }

    if session.is_session_intent() {
        return session.intent_still_valid();
    }

    matches!(
        authenticator.validate_session(username, true).await,
        Ok(Some(_))
    )
}

fn is_session_intent_username(username: &str) -> bool {
    username.eq_ignore_ascii_case("intent") || username.eq_ignore_ascii_case("session-intent")
}

/// Subset of ServiceConfiguration enforced by the edge-gateway (N-01).
/// Only the fields needed for policy enforcement are deserialized.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NodeConfig {
    #[serde(default)]
    pub allowed_ports: Vec<i64>,
    #[serde(default)]
    pub blocked_ports: Vec<i64>,
    #[serde(default)]
    pub allowed_domains: Vec<String>,
    #[serde(default)]
    pub blocked_domains: Vec<String>,
    #[serde(default)]
    pub max_bandwidth_mbps: i64,
    #[serde(default = "NodeConfig::default_active")]
    pub is_active: bool,
}

impl NodeConfig {
    fn default_active() -> bool {
        true
    }
}

/// P0-A2: Cache statistics for monitoring
#[derive(Debug, Clone)]
pub struct CacheStats {
    pub size: usize,
    pub max_size: usize,
    pub ttl_secs: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_verify_credential_password() {
        use sha2::{Digest, Sha256};
        let password = "marketplace-secret";
        let mut hasher = Sha256::new();
        hasher.update(password.as_bytes());
        let hash = hex::encode(hasher.finalize());
        assert!(verify_credential_password(&hash, password));
        assert!(!verify_credential_password(&hash, "wrong"));
    }

    #[test]
    fn test_session_data_p2p_fields_deserialization() {
        let json = r#"{
            "user_id": "user-123",
            "session_id": "sess-456",
            "type": "sticky",
            "status": "active",
            "bandwidth_limit": 1000,
            "bandwidth_used": 0,
            "listing_id": "listing-1",
            "node_id": "node_abc",
            "credential_password_hash": "deadbeef"
        }"#;
        let session: SessionData = serde_json::from_str(json).expect("Failed to parse");
        assert_eq!(session.listing_id, "listing-1");
        assert_eq!(session.node_id, "node_abc");
        assert_eq!(session.credential_password_hash, "deadbeef");
    }

    #[test]
    fn test_session_data_deserialization() {
        let json = r#"{
            "user_id": "user-123",
            "session_id": "sess-456",
            "type": "rotating",
            "status": "active",
            "bandwidth_limit": 5368709120,
            "bandwidth_used": 1073741824
        }"#;

        let session: SessionData = serde_json::from_str(json).expect("Failed to parse");

        assert_eq!(session.user_id, "user-123");
        assert_eq!(session.session_id, "sess-456");
        assert_eq!(session.session_type, "rotating");
        assert_eq!(session.status, "active");
        assert_eq!(session.bandwidth_limit, 5368709120); // 5GB
        assert_eq!(session.bandwidth_used, 1073741824); // 1GB
    }

    #[test]
    fn test_session_data_serialization() {
        let session = SessionData {
            user_id: "user-789".to_string(),
            session_id: "sess-abc".to_string(),
            session_type: "sticky".to_string(),
            status: "active".to_string(),
            bandwidth_limit: 10737418240,
            bandwidth_used: 0,
            ..Default::default()
        };

        let json = serde_json::to_string(&session).expect("Failed to serialize");
        assert!(json.contains("user-789"));
        assert!(json.contains("sticky"));
    }

    #[test]
    fn test_session_status_check() {
        let active_session = SessionData {
            user_id: "u1".to_string(),
            session_id: "s1".to_string(),
            session_type: "rotating".to_string(),
            status: "active".to_string(),
            bandwidth_limit: 1000,
            bandwidth_used: 500,
            ..Default::default()
        };

        assert_eq!(active_session.status, "active");
        assert!(active_session.bandwidth_used < active_session.bandwidth_limit);

        let terminated_session = SessionData {
            status: "terminated".to_string(),
            ..active_session.clone()
        };

        assert_ne!(terminated_session.status, "active");
    }

    #[test]
    fn test_bandwidth_limit_exceeded() {
        let session = SessionData {
            user_id: "u1".to_string(),
            session_id: "s1".to_string(),
            session_type: "rotating".to_string(),
            status: "active".to_string(),
            bandwidth_limit: 1000,
            bandwidth_used: 1500, // Exceeded
            ..Default::default()
        };

        assert!(!session.has_remaining_bandwidth());
    }

    #[test]
    fn zero_bandwidth_limit_is_unlimited_for_legacy_session_contract() {
        let session = SessionData {
            user_id: "u1".to_string(),
            session_id: "s1".to_string(),
            session_type: "rotating".to_string(),
            status: "active".to_string(),
            bandwidth_limit: 0,
            bandwidth_used: i64::MAX,
            credential_password_hash: credential_hash("correct-password"),
            ..Default::default()
        };

        assert!(session.has_remaining_bandwidth());
        assert!(session.legacy_credentials_match("correct-password"));
    }

    #[test]
    fn negative_bandwidth_limit_is_unlimited_for_legacy_session_contract() {
        let session = SessionData {
            bandwidth_limit: -1,
            bandwidth_used: i64::MAX,
            ..Default::default()
        };

        assert!(session.has_remaining_bandwidth());
    }

    #[test]
    fn legacy_credential_sessions_require_password_hash() {
        let session = SessionData {
            credential_password_hash: String::new(),
            ..Default::default()
        };

        assert!(!session.legacy_credentials_match("any-password"));
    }

    #[test]
    fn legacy_credential_sessions_require_matching_password_hash() {
        let session = SessionData {
            credential_password_hash: credential_hash("correct-password"),
            ..Default::default()
        };

        assert!(session.legacy_credentials_match("correct-password"));
        assert!(!session.legacy_credentials_match("wrong-password"));
    }

    #[test]
    fn zero_bandwidth_limit_is_unlimited_for_session_intent_contract() {
        let claims = session_intent::SessionIntentClaims {
            sub: "user-123".to_string(),
            listing_id: "listing-123".to_string(),
            session_type: "sticky".to_string(),
            trust_tier: "verified".to_string(),
            bandwidth_limit: 0,
            target_geo: "GH".to_string(),
            target_isp: "FiberCo".to_string(),
            routing_profile: "default".to_string(),
            allowed_domains: Vec::new(),
            blocked_domains: Vec::new(),
            rotation_type: "none".to_string(),
            rotation_interval_seconds: 0,
            time_limit_minutes: 0,
            preferred_tier: "verified".to_string(),
            requests_per_minute: 120,
            max_concurrency: 4,
            max_price_per_gb: 0.01,
            aud: session_intent::AudienceClaim::One("proxyhubb-edge-gateway".to_string()),
            exp: usize::MAX,
            iat: 1,
            iss: "proxyhubb-control-api".to_string(),
            jti: "intent-123".to_string(),
            nbf: 1,
        };
        let mut session = SessionData::from_session_intent(&claims);
        session.bandwidth_used = i64::MAX;

        assert!(session.is_session_intent());
        assert_eq!(session.bandwidth_limit, 0);
        assert!(session.has_remaining_bandwidth());
    }

    #[test]
    fn session_within_time_limit_respects_expires_at() {
        let session = SessionData {
            expires_at: Some(Utc::now() - chrono::Duration::minutes(1)),
            ..Default::default()
        };
        assert!(!session.session_within_time_limit());
    }

    #[test]
    fn session_within_time_limit_respects_created_plus_minutes() {
        let session = SessionData {
            created_at: Some(Utc::now() - chrono::Duration::minutes(31)),
            time_limit_minutes: 30,
            ..Default::default()
        };
        assert!(!session.session_within_time_limit());
    }

    #[test]
    fn session_intent_jwt_expiry_enforced() {
        let session = SessionData {
            auth_source: "session_intent".to_string(),
            intent_expires_at: 1,
            ..Default::default()
        };
        assert!(!session.session_within_time_limit());
    }

    fn credential_hash(password: &str) -> String {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(password.as_bytes());
        hex::encode(hasher.finalize())
    }
}

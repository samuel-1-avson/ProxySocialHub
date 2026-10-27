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
use std::sync::Arc;
use std::time::Duration;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProxyAuthSource {
    LegacySession,
    SessionIntent,
    SessionCapability,
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

    // Per-session enforcement limits (GW-03). 0 = unlimited. Sourced from
    // session-intent JWT claims; control-api session sync may also populate them.
    #[serde(default)]
    pub max_concurrency: i32,
    #[serde(default)]
    pub requests_per_minute: i32,

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

    // W5.C.2 — marketplace order credential HMAC bound at activation.
    #[serde(default)]
    pub order_id: String,
    #[serde(default)]
    pub credential_proof_username_hash: String,
    #[serde(default)]
    pub credential_proof_payload_hash: String,
    #[serde(default)]
    pub credential_proof_signature: String,
    #[serde(default)]
    pub credential_proof_issued_at: i64,
    #[serde(default)]
    pub credential_proof_expires_at: i64,

    // W7.A — Ed25519 session capability (verify locally; Redis is a cache).
    #[serde(default)]
    pub capability_version: String,
    #[serde(default)]
    pub capability_offer_hash: String,
    #[serde(default)]
    pub capability_buyer_id: String,
    #[serde(default)]
    pub capability_expires_at: i64,
    #[serde(default)]
    pub capability_bandwidth_limit: i64,
    #[serde(default)]
    pub capability_operator_pubkey: String,
    #[serde(default)]
    pub capability_username_hash: String,
    #[serde(default)]
    pub capability_issued_at: i64,
    #[serde(default)]
    pub capability_signature: String,
    #[serde(default)]
    pub capability_issuer_pubkey: String,
    #[serde(default)]
    pub capability_token: String,
}

/// PROXYHUB_CREDENTIAL_PROOF: off | observe | enforce (default off).
pub fn credential_proof_mode() -> &'static str {
    match std::env::var("PROXYHUB_CREDENTIAL_PROOF")
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "enforce" | "1" | "true" | "yes" | "on" => "enforce",
        "observe" => "observe",
        _ => "off",
    }
}

pub fn credential_proof_enforce() -> bool {
    credential_proof_mode() == "enforce"
}

/// PROXYHUB_SESSION_CAPABILITY: off | observe | enforce (default off).
pub fn session_capability_mode() -> &'static str {
    match std::env::var("PROXYHUB_SESSION_CAPABILITY")
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "enforce" => "enforce",
        "observe" | "1" | "true" | "yes" | "on" => "observe",
        _ => "off",
    }
}

pub fn session_capability_enforce() -> bool {
    session_capability_mode() == "enforce"
}

fn session_capability_issuer_allowlist() -> Vec<String> {
    let mut keys: Vec<String> = std::env::var("PROXYHUB_SESSION_CAPABILITY_ISSUER_PUBKEY")
        .unwrap_or_default()
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    for pk in crate::operator_bundle::snapshot().verified_issuer_pubkeys() {
        if !keys.iter().any(|e| e == &pk) {
            keys.push(pk);
        }
    }
    keys
}

const SESSION_CAPABILITY_TOKEN_PREFIX: &str = "phubb1.";

/// Wire object packed as `phubb1.` + base64url(JSON) (W7.C CONNECT password).
#[derive(Debug, Clone, Serialize, Deserialize)]
struct CapabilityTokenWire {
    #[serde(default, rename = "v")]
    version: String,
    session_id: String,
    offer_hash: String,
    buyer_id: String,
    expires_at: i64,
    bandwidth_limit: i64,
    operator_pubkey: String,
    username_hash: String,
    issued_at: i64,
    signature: String,
    issuer_pubkey: String,
}

fn looks_like_capability_token(password: &str) -> bool {
    password.trim().starts_with(SESSION_CAPABILITY_TOKEN_PREFIX)
}

fn parse_capability_password(password: &str) -> Option<SessionData> {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;
    let rest = password
        .trim()
        .strip_prefix(SESSION_CAPABILITY_TOKEN_PREFIX)?;
    if rest.is_empty() {
        return None;
    }
    let raw = URL_SAFE_NO_PAD.decode(rest.as_bytes()).ok()?;
    let tok: CapabilityTokenWire = serde_json::from_slice(&raw).ok()?;
    if !tok.version.is_empty() && tok.version != "1" {
        return None;
    }
    Some(SessionData::from_capability_token(&tok))
}

/// Admit from a self-contained `phubb1.` password. Does not read Redis `session:`.
fn admit_capability_token(username: &str, password: &str) -> Option<SessionData> {
    let session = parse_capability_password(password)?;
    if session.session_capability_valid(username) {
        Some(session)
    } else {
        None
    }
}

#[cfg(test)]
fn encode_capability_token(tok: &CapabilityTokenWire) -> Option<String> {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;
    let raw = serde_json::to_vec(tok).ok()?;
    Some(format!(
        "{SESSION_CAPABILITY_TOKEN_PREFIX}{}",
        URL_SAFE_NO_PAD.encode(raw)
    ))
}

fn canonical_session_capability_bytes(
    session_id: &str,
    offer_hash: &str,
    buyer_id: &str,
    expires_at: i64,
    bandwidth_limit: i64,
    operator_pubkey: &str,
    username_hash: &str,
    issued_at: i64,
) -> Vec<u8> {
    format!(
        "PROXYHUB_SESSION_CAPABILITY:v1:{session_id}|{offer_hash}|{buyer_id}|{expires_at}|{bandwidth_limit}|{operator_pubkey}|{username_hash}|{issued_at}"
    )
    .into_bytes()
}

fn verify_ed25519_b58(pubkey_b58: &str, message: &[u8], signature_b58: &str) -> bool {
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};
    let pk = match bs58::decode(pubkey_b58.trim()).into_vec() {
        Ok(v) => v,
        Err(_) => return false,
    };
    let sig = match bs58::decode(signature_b58.trim()).into_vec() {
        Ok(v) => v,
        Err(_) => return false,
    };
    let vk = match VerifyingKey::try_from(pk.as_slice()) {
        Ok(v) => v,
        Err(_) => return false,
    };
    let signature = match Signature::try_from(sig.as_slice()) {
        Ok(s) => s,
        Err(_) => return false,
    };
    vk.verify(message, &signature).is_ok()
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

fn hash_order_credential_payload(
    order_id: &str,
    session_id: &str,
    buyer_id: &str,
    listing_id: &str,
    username_hash: &str,
    issued_at: i64,
    expires_at: i64,
) -> String {
    let canonical = format!(
        "PROXYHUB_ORDER_CREDENTIAL_V1|1|{order_id}|{session_id}|{buyer_id}|{listing_id}|{username_hash}|{issued_at}|{expires_at}"
    );
    sha256_hex(canonical.as_bytes())
}

fn verify_credential_proof_hmac(payload_hash: &str, signature_hex: &str, secret: &str) -> bool {
    use ring::hmac;
    let key = hmac::Key::new(hmac::HMAC_SHA256, secret.as_bytes());
    let tag = hmac::sign(&key, payload_hash.as_bytes());
    let want = hex::encode(tag.as_ref());
    constant_time_eq(want.as_bytes(), signature_hex.as_bytes())
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
    /// Sprint J0: optional control-api client for PG hydrate on Redis miss.
    control_api: Option<Arc<crate::control_api::ControlApiClient>>,
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
            control_api: None,
        };

        // Start background task to report cache metrics
        authenticator.start_metrics_task();

        Ok(authenticator)
    }

    /// Attach control-api hydrate client (Sprint J0).
    pub fn with_control_api(mut self, client: Arc<crate::control_api::ControlApiClient>) -> Self {
        self.control_api = Some(client);
        self
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

    /// Validate session and return session data if valid.
    /// Always merges Redis `session:{user}:usage` before the bandwidth check so
    /// CONNECT rejects over-quota buyers even when the session JSON still has
    /// `bandwidth_used: 0` (GW-08 / backlog 1.2 entitlement).
    pub async fn validate_session(
        &self,
        username: &str,
        force_refresh: bool,
    ) -> Result<Option<SessionData>, Box<dyn Error + Send + Sync>> {
        // Check cache first
        if !force_refresh {
            if let Some(mut session_data) = self.cache.get(username).await {
                metrics::record_session_cache_hit();
                // Re-check live usage + time on every admit (cheap GET).
                let used = self
                    .fetch_usage_bytes(username)
                    .await
                    .unwrap_or(session_data.bandwidth_used);
                merge_live_usage(&mut session_data, used);
                if session_data.status != "active"
                    || !session_data.has_remaining_bandwidth()
                    || !session_data.session_within_time_limit()
                {
                    self.invalidate_cache(username).await;
                    return Ok(None);
                }
                return Ok(Some(session_data));
            }
            metrics::record_session_cache_miss();
        } else {
            // Forced refresh counts as cache miss
            metrics::record_session_cache_miss();
        }

        // Fetch from Redis. On pool/GET failure, attempt PG hydrate (EV-05 lite)
        // before fail-closed — covers Redis down, not only key miss.
        let key = redis_keys::session(username);
        let data: Result<Option<String>, _> = async {
            let mut con = self.conn_pool.get().await?;
            let v: Option<String> = con.get(&key).await?;
            Ok::<_, Box<dyn Error + Send + Sync>>(v)
        }
        .await;

        let json_str = match data {
            Ok(Some(json_str)) => json_str,
            Ok(None) => {
                // Sprint J0: Redis miss → hydrate from control-api PG dual-write cache.
                match self.hydrate_and_rewarm(username).await? {
                    Some(session_data) => {
                        return self.admit_loaded_session(username, session_data).await;
                    }
                    None => return Ok(None),
                }
            }
            Err(redis_err) => match self.hydrate_and_rewarm(username).await {
                Ok(Some(session_data)) => {
                    return self.admit_loaded_session(username, session_data).await;
                }
                Ok(None) => return Err(redis_err),
                Err(hydrate_err) => return Err(hydrate_err),
            },
        };

        let session_data: SessionData = serde_json::from_str(&json_str)?;
        self.admit_loaded_session(username, session_data).await
    }

    async fn admit_loaded_session(
        &self,
        username: &str,
        mut session_data: SessionData,
    ) -> Result<Option<SessionData>, Box<dyn Error + Send + Sync>> {
        if session_data.status != "active" {
            return Ok(None);
        }

        let used = self
            .fetch_usage_bytes(username)
            .await
            .unwrap_or(session_data.bandwidth_used);
        merge_live_usage(&mut session_data, used);

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

    async fn hydrate_and_rewarm(
        &self,
        username: &str,
    ) -> Result<Option<SessionData>, Box<dyn Error + Send + Sync>> {
        let Some(client) = self.control_api.as_ref() else {
            return Ok(None);
        };
        let Some(session_data) = client.hydrate_session(username).await.map_err(|e| {
            Box::new(std::io::Error::other(e.to_string())) as Box<dyn Error + Send + Sync>
        })?
        else {
            return Ok(None);
        };

        // Best-effort rewarm Redis so subsequent CONNECT hits the hot path.
        if let Ok(json) = serde_json::to_string(&session_data) {
            if let Ok(mut con) = self.conn_pool.get().await {
                let key = redis_keys::session(username);
                let _: Result<(), _> = con
                    .set_ex::<_, _, ()>(&key, json, self.cache_ttl.as_secs().max(60))
                    .await;
            }
        }

        Ok(Some(session_data))
    }

    /// Live usage counter written by `report_usage` (and control-api IncrementUsage).
    pub async fn fetch_usage_bytes(
        &self,
        username: &str,
    ) -> Result<i64, Box<dyn Error + Send + Sync>> {
        let mut con = self.conn_pool.get().await?;
        let key = redis_keys::session_usage(username);
        let used: Option<i64> = con.get(&key).await?;
        Ok(used.unwrap_or(0))
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
            let mut session_data = SessionData::from_session_intent(&claims);

            // Intent JWTs bake bandwidth_limit but never bandwidth_used — merge
            // the live Redis counter so exhausted intents are rejected at CONNECT.
            let used = self
                .fetch_usage_bytes(&resolved_username)
                .await
                .unwrap_or(0);
            merge_live_usage(&mut session_data, used);
            if !session_data.has_remaining_bandwidth() || !session_data.session_within_time_limit()
            {
                return Ok(None);
            }

            self.cache
                .insert(resolved_username.clone(), session_data.clone())
                .await;

            return Ok(Some(ResolvedProxySession {
                username: resolved_username,
                session: session_data,
                source: ProxyAuthSource::SessionIntent,
            }));
        }

        // W7.C: token-first. Password phubb1.… is a self-contained capability.
        // Redis session: is not consulted (admission). Usage WAL is best-effort.
        if session_capability_enforce() && looks_like_capability_token(password) {
            match admit_capability_token(username, password) {
                Some(mut session) => {
                    let used = self.fetch_usage_bytes(username).await.unwrap_or(0);
                    merge_live_usage(&mut session, used);
                    if !session.has_remaining_bandwidth() || !session.session_within_time_limit() {
                        return Ok(None);
                    }
                    self.cache
                        .insert(username.to_string(), session.clone())
                        .await;
                    return Ok(Some(ResolvedProxySession {
                        username: username.to_string(),
                        session,
                        source: ProxyAuthSource::SessionCapability,
                    }));
                }
                None => {
                    tracing::warn!(
                        "Rejected CONNECT: session capability token invalid (Redis not consulted)"
                    );
                    return Ok(None);
                }
            }
        }

        let session = match self.validate_session(username, false).await? {
            Some(session) => session,
            None => return Ok(None),
        };

        if !session.legacy_credentials_match(password) {
            return Ok(None);
        }

        // W7.A: marketplace sessions may be admitted by a local Ed25519 capability
        // (no CONTROL_API_URL). When capability enforce is on, HMAC is not required.
        if session_capability_enforce()
            && !session.listing_id.trim().is_empty()
            && !session.session_capability_valid(username)
        {
            tracing::warn!(
                session_id = %session.session_id,
                listing_id = %session.listing_id,
                "Rejected CONNECT: session capability enforce failed"
            );
            return Ok(None);
        }

        // W5.C.2: marketplace sessions (listing_id set) must carry a valid HMAC proof
        // unless W7.A capability enforce already authorized the CONNECT.
        if credential_proof_enforce()
            && !session_capability_enforce()
            && !session.listing_id.trim().is_empty()
            && !session.credential_proof_valid(username, intent_secret)
        {
            tracing::warn!(
                session_id = %session.session_id,
                listing_id = %session.listing_id,
                "Rejected CONNECT: credential proof enforce failed"
            );
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
            max_concurrency: claims.max_concurrency,
            requests_per_minute: claims.requests_per_minute,
            auth_source: "session_intent".to_string(),
            intent_expires_at: claims.exp as i64,
            ..Default::default()
        }
    }

    fn from_capability_token(tok: &CapabilityTokenWire) -> Self {
        let version = if tok.version.trim().is_empty() {
            "1".to_string()
        } else {
            tok.version.clone()
        };
        Self {
            user_id: tok.buyer_id.clone(),
            session_id: tok.session_id.clone(),
            session_type: "sticky".to_string(),
            status: "active".to_string(),
            bandwidth_limit: tok.bandwidth_limit,
            bandwidth_used: 0,
            listing_id: tok.offer_hash.clone(),
            created_at: DateTime::from_timestamp(tok.issued_at, 0),
            expires_at: DateTime::from_timestamp(tok.expires_at, 0),
            auth_source: "session_capability".to_string(),
            capability_version: version,
            capability_offer_hash: tok.offer_hash.clone(),
            capability_buyer_id: tok.buyer_id.clone(),
            capability_expires_at: tok.expires_at,
            capability_bandwidth_limit: tok.bandwidth_limit,
            capability_operator_pubkey: tok.operator_pubkey.clone(),
            capability_username_hash: tok.username_hash.clone(),
            capability_issued_at: tok.issued_at,
            capability_signature: tok.signature.clone(),
            capability_issuer_pubkey: tok.issuer_pubkey.clone(),
            capability_token: String::new(),
            ..Default::default()
        }
    }

    pub fn is_session_intent(&self) -> bool {
        self.auth_source == "session_intent"
    }

    pub fn is_session_capability(&self) -> bool {
        self.auth_source == "session_capability"
    }

    pub fn has_remaining_bandwidth(&self) -> bool {
        self.bandwidth_limit <= 0 || self.bandwidth_used < self.bandwidth_limit
    }

    fn legacy_credentials_match(&self, password: &str) -> bool {
        !self.credential_password_hash.trim().is_empty()
            && verify_credential_password(&self.credential_password_hash, password)
    }

    /// Verify bound order-credential HMAC (control-api SESSION_SECRET / intent secret).
    pub fn credential_proof_valid(&self, username: &str, secret: &str) -> bool {
        if self.credential_proof_signature.trim().is_empty()
            || self.credential_proof_payload_hash.trim().is_empty()
            || secret.trim().is_empty()
        {
            return false;
        }
        if self.credential_proof_expires_at > 0 {
            let now = Utc::now().timestamp();
            if now > self.credential_proof_expires_at {
                return false;
            }
        }
        let username_hash = sha256_hex(username.trim().as_bytes());
        if !constant_time_eq(
            username_hash.as_bytes(),
            self.credential_proof_username_hash.as_bytes(),
        ) {
            return false;
        }
        let recomputed = hash_order_credential_payload(
            self.order_id.trim(),
            self.session_id.trim(),
            self.user_id.trim(),
            self.listing_id.trim(),
            self.credential_proof_username_hash.trim(),
            self.credential_proof_issued_at,
            self.credential_proof_expires_at,
        );
        if !constant_time_eq(
            recomputed.as_bytes(),
            self.credential_proof_payload_hash.as_bytes(),
        ) {
            return false;
        }
        verify_credential_proof_hmac(
            &self.credential_proof_payload_hash,
            &self.credential_proof_signature,
            secret,
        )
    }

    /// Verify Wave 7.A Ed25519 capability with the configured issuer allowlist.
    /// Does not call control-api.
    pub fn session_capability_valid(&self, username: &str) -> bool {
        if self.capability_signature.trim().is_empty() {
            return false;
        }
        if self.capability_expires_at > 0 {
            let now = Utc::now().timestamp();
            if now > self.capability_expires_at {
                return false;
            }
        } else {
            return false;
        }
        let username_hash = sha256_hex(username.trim().as_bytes());
        if !constant_time_eq(
            username_hash.as_bytes(),
            self.capability_username_hash.as_bytes(),
        ) {
            return false;
        }
        let allowlist = session_capability_issuer_allowlist();
        if allowlist.is_empty() {
            return false;
        }
        let issuer = self.capability_issuer_pubkey.trim();
        if issuer.is_empty() || !allowlist.iter().any(|k| k == issuer) {
            return false;
        }
        if let Ok(local_op) = std::env::var("PROXYHUB_SESSION_CAPABILITY_LOCAL_OPERATOR_PUBKEY") {
            let local_op = local_op.trim();
            if !local_op.is_empty() && local_op != self.capability_operator_pubkey.trim() {
                return false;
            }
        }
        let message = canonical_session_capability_bytes(
            self.session_id.trim(),
            self.capability_offer_hash.trim(),
            self.capability_buyer_id.trim(),
            self.capability_expires_at,
            self.capability_bandwidth_limit,
            self.capability_operator_pubkey.trim(),
            self.capability_username_hash.trim(),
            self.capability_issued_at,
        );
        verify_ed25519_b58(issuer, &message, &self.capability_signature)
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

        if self.is_session_capability() {
            if self.capability_expires_at <= 0 || now.timestamp() > self.capability_expires_at {
                return false;
            }
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

fn merge_live_usage(session: &mut SessionData, used: i64) {
    if used > session.bandwidth_used {
        session.bandwidth_used = used;
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

    // Intent JWTs and W7.C capability tokens are self-contained. Do not Redis GET
    // `session:` (that would kill a live CONNECT when the blob is missing).
    if session.is_session_intent() || session.is_session_capability() {
        if session.is_session_intent() && !session.intent_still_valid() {
            return false;
        }
        if session.bandwidth_limit <= 0 {
            return true;
        }
        let used = authenticator
            .fetch_usage_bytes(username)
            .await
            .unwrap_or(session.bandwidth_used);
        let mut live = session.clone();
        merge_live_usage(&mut live, used);
        return live.has_remaining_bandwidth();
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
    use std::sync::Mutex;

    static CAPABILITY_ENV_LOCK: Mutex<()> = Mutex::new(());

    fn reset_operator_bundle() {
        crate::operator_bundle::store_for_test(crate::operator_bundle::LoadedBundle {
            discovery_sot: "none".into(),
            source: String::new(),
            operators: vec![],
            error: String::new(),
        });
    }

    #[test]
    fn merge_live_usage_takes_max() {
        let mut session = SessionData {
            bandwidth_limit: 1000,
            bandwidth_used: 100,
            ..Default::default()
        };
        merge_live_usage(&mut session, 50);
        assert_eq!(session.bandwidth_used, 100);
        merge_live_usage(&mut session, 900);
        assert_eq!(session.bandwidth_used, 900);
        assert!(session.has_remaining_bandwidth());
        merge_live_usage(&mut session, 1000);
        assert!(!session.has_remaining_bandwidth());
    }

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
    fn credential_proof_valid_matches_control_api_hmac() {
        let secret = "test-session-secret";
        let username = "buyer-cred-user";
        let order_id = "11111111-1111-1111-1111-111111111111";
        let session_id = "22222222-2222-2222-2222-222222222222";
        let buyer_id = "33333333-3333-3333-3333-333333333333";
        let listing_id = "44444444-4444-4444-4444-444444444444";
        let issued_at = Utc::now().timestamp() - 60;
        let expires_at = issued_at + 3600;
        let username_hash = sha256_hex(username.as_bytes());
        let payload_hash = hash_order_credential_payload(
            order_id,
            session_id,
            buyer_id,
            listing_id,
            &username_hash,
            issued_at,
            expires_at,
        );
        let key = ring::hmac::Key::new(ring::hmac::HMAC_SHA256, secret.as_bytes());
        let signature = hex::encode(ring::hmac::sign(&key, payload_hash.as_bytes()).as_ref());

        let session = SessionData {
            user_id: buyer_id.to_string(),
            session_id: session_id.to_string(),
            listing_id: listing_id.to_string(),
            order_id: order_id.to_string(),
            credential_proof_username_hash: username_hash,
            credential_proof_payload_hash: payload_hash,
            credential_proof_signature: signature,
            credential_proof_issued_at: issued_at,
            credential_proof_expires_at: expires_at,
            ..Default::default()
        };
        assert!(session.credential_proof_valid(username, secret));
        assert!(!session.credential_proof_valid(username, "wrong-secret"));
        assert!(!session.credential_proof_valid("other-user", secret));
    }

    #[test]
    fn canonical_session_capability_matches_control_api() {
        let got = canonical_session_capability_bytes(
            "22222222-2222-2222-2222-222222222222",
            "aabb",
            "33333333-3333-3333-3333-333333333333",
            1700086400,
            1024,
            "opk",
            "uh",
            1700000000,
        );
        let want = b"PROXYHUB_SESSION_CAPABILITY:v1:22222222-2222-2222-2222-222222222222|aabb|33333333-3333-3333-3333-333333333333|1700086400|1024|opk|uh|1700000000";
        assert_eq!(got, want);
    }

    #[test]
    fn session_capability_valid_local_ed25519() {
        use ed25519_dalek::{Signer, SigningKey};
        let _guard = CAPABILITY_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        reset_operator_bundle();
        let signing_key = SigningKey::from_bytes(&[7_u8; 32]);
        let issuer = bs58::encode(signing_key.verifying_key().as_bytes()).into_string();
        let username = "buyer-cred-user";
        let username_hash = sha256_hex(username.as_bytes());
        let session_id = "22222222-2222-2222-2222-222222222222";
        let offer_hash = "aabb";
        let buyer_id = "33333333-3333-3333-3333-333333333333";
        let issued_at = Utc::now().timestamp() - 60;
        let expires_at = issued_at + 3600;
        let bandwidth = 1024i64;
        let message = canonical_session_capability_bytes(
            session_id,
            offer_hash,
            buyer_id,
            expires_at,
            bandwidth,
            &issuer,
            &username_hash,
            issued_at,
        );
        let signature = bs58::encode(signing_key.sign(&message).to_bytes()).into_string();

        std::env::set_var("PROXYHUB_SESSION_CAPABILITY_ISSUER_PUBKEY", &issuer);
        let session = SessionData {
            session_id: session_id.to_string(),
            listing_id: "listing-1".to_string(),
            capability_offer_hash: offer_hash.to_string(),
            capability_buyer_id: buyer_id.to_string(),
            capability_expires_at: expires_at,
            capability_bandwidth_limit: bandwidth,
            capability_operator_pubkey: issuer.clone(),
            capability_username_hash: username_hash,
            capability_issued_at: issued_at,
            capability_signature: signature,
            capability_issuer_pubkey: issuer,
            ..Default::default()
        };
        assert!(session.session_capability_valid(username));
        assert!(!session.session_capability_valid("other-user"));
        std::env::set_var(
            "PROXYHUB_SESSION_CAPABILITY_ISSUER_PUBKEY",
            "11111111111111111111111111111111",
        );
        assert!(!session.session_capability_valid(username));
        std::env::remove_var("PROXYHUB_SESSION_CAPABILITY_ISSUER_PUBKEY");
    }

    #[test]
    fn session_capability_valid_bundle_operator_issuer() {
        use ed25519_dalek::{Signer, SigningKey};
        let _guard = CAPABILITY_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        reset_operator_bundle();
        let signing_key = SigningKey::from_bytes(&[13_u8; 32]);
        let operator = bs58::encode(signing_key.verifying_key().as_bytes()).into_string();
        let username = "buyer-cred-user";
        let username_hash = sha256_hex(username.as_bytes());
        let session_id = "22222222-2222-2222-2222-222222222222";
        let offer_hash = "aabb";
        let buyer_id = "33333333-3333-3333-3333-333333333333";
        let issued_at = Utc::now().timestamp() - 60;
        let expires_at = issued_at + 3600;
        let bandwidth = 1024i64;
        let message = canonical_session_capability_bytes(
            session_id,
            offer_hash,
            buyer_id,
            expires_at,
            bandwidth,
            &operator,
            &username_hash,
            issued_at,
        );
        let signature = bs58::encode(signing_key.sign(&message).to_bytes()).into_string();
        let session = SessionData {
            session_id: session_id.to_string(),
            listing_id: "listing-1".to_string(),
            capability_offer_hash: offer_hash.to_string(),
            capability_buyer_id: buyer_id.to_string(),
            capability_expires_at: expires_at,
            capability_bandwidth_limit: bandwidth,
            capability_operator_pubkey: operator.clone(),
            capability_username_hash: username_hash,
            capability_issued_at: issued_at,
            capability_signature: signature,
            capability_issuer_pubkey: operator.clone(),
            ..Default::default()
        };

        std::env::set_var(
            "PROXYHUB_SESSION_CAPABILITY_ISSUER_PUBKEY",
            "11111111111111111111111111111111",
        );
        crate::operator_bundle::store_for_test(crate::operator_bundle::LoadedBundle {
            discovery_sot: "bundle".into(),
            source: "test".into(),
            operators: vec![crate::operator_bundle::VerifiedOperator {
                slug: "edge-ext".into(),
                host_id: "vps-1".into(),
                org_id: "ext-operator-org-1".into(),
                buyer_base_url: String::new(),
                pubkey: operator,
                verified: true,
                reason: String::new(),
            }],
            error: String::new(),
        });
        assert!(
            session.session_capability_valid(username),
            "verified bundle pubkey must be an accepted issuer"
        );

        crate::operator_bundle::store_for_test(crate::operator_bundle::LoadedBundle {
            discovery_sot: "bundle".into(),
            source: "test".into(),
            operators: vec![crate::operator_bundle::VerifiedOperator {
                slug: "edge-ext".into(),
                host_id: "vps-1".into(),
                org_id: "ext-operator-org-1".into(),
                buyer_base_url: String::new(),
                pubkey: session.capability_issuer_pubkey.clone(),
                verified: false,
                reason: "unsigned".into(),
            }],
            error: String::new(),
        });
        assert!(
            !session.session_capability_valid(username),
            "unverified bundle pubkey must not be an issuer"
        );

        reset_operator_bundle();
        std::env::remove_var("PROXYHUB_SESSION_CAPABILITY_ISSUER_PUBKEY");
    }

    fn mint_w7c_token(username: &str) -> (String, String) {
        use ed25519_dalek::{Signer, SigningKey};
        let signing_key = SigningKey::from_bytes(&[11_u8; 32]);
        let issuer = bs58::encode(signing_key.verifying_key().as_bytes()).into_string();
        let username_hash = sha256_hex(username.trim().as_bytes());
        let session_id = "22222222-2222-2222-2222-222222222222";
        let offer_hash = "aabb";
        let buyer_id = "33333333-3333-3333-3333-333333333333";
        let issued_at = Utc::now().timestamp() - 60;
        let expires_at = issued_at + 3600;
        let bandwidth = 1024i64;
        let message = canonical_session_capability_bytes(
            session_id,
            offer_hash,
            buyer_id,
            expires_at,
            bandwidth,
            &issuer,
            &username_hash,
            issued_at,
        );
        let signature = bs58::encode(signing_key.sign(&message).to_bytes()).into_string();
        let tok = CapabilityTokenWire {
            version: "1".to_string(),
            session_id: session_id.to_string(),
            offer_hash: offer_hash.to_string(),
            buyer_id: buyer_id.to_string(),
            expires_at,
            bandwidth_limit: bandwidth,
            operator_pubkey: issuer.clone(),
            username_hash,
            issued_at,
            signature,
            issuer_pubkey: issuer.clone(),
        };
        let wire = encode_capability_token(&tok).expect("encode");
        (issuer, wire)
    }

    #[test]
    fn capability_token_roundtrip_admits_without_redis() {
        let _guard = CAPABILITY_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        reset_operator_bundle();
        let username = "w7c-buyer";
        let (issuer, wire) = mint_w7c_token(username);
        assert!(looks_like_capability_token(&wire));
        assert!(looks_like_capability_token(&format!("  {wire}")));
        std::env::set_var("PROXYHUB_SESSION_CAPABILITY_ISSUER_PUBKEY", &issuer);

        let session = admit_capability_token(username, &wire).expect("admit");
        assert!(session.is_session_capability());
        assert_eq!(session.session_id, "22222222-2222-2222-2222-222222222222");
        assert_eq!(session.listing_id, "aabb");
        assert_eq!(session.user_id, "33333333-3333-3333-3333-333333333333");
        assert_eq!(session.bandwidth_limit, 1024);
        assert!(session.session_capability_valid(username));
        assert!(session.session_within_time_limit());
        assert!(admit_capability_token("other-user", &wire).is_none());

        std::env::remove_var("PROXYHUB_SESSION_CAPABILITY_ISSUER_PUBKEY");
    }

    #[test]
    fn capability_token_admits_verified_bundle_issuer() {
        let _guard = CAPABILITY_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        reset_operator_bundle();
        let username = "w7c-buyer";
        let (issuer, wire) = mint_w7c_token(username);
        std::env::set_var(
            "PROXYHUB_SESSION_CAPABILITY_ISSUER_PUBKEY",
            "11111111111111111111111111111111",
        );
        crate::operator_bundle::store_for_test(crate::operator_bundle::LoadedBundle {
            discovery_sot: "bundle".into(),
            source: "test".into(),
            operators: vec![crate::operator_bundle::VerifiedOperator {
                slug: "edge-ext".into(),
                host_id: "vps-1".into(),
                org_id: "ext-operator-org-1".into(),
                buyer_base_url: String::new(),
                pubkey: issuer.clone(),
                verified: true,
                reason: String::new(),
            }],
            error: String::new(),
        });
        assert!(
            admit_capability_token(username, &wire).is_some(),
            "phubb1 token from a verified bundle issuer must admit without the platform env key"
        );

        crate::operator_bundle::store_for_test(crate::operator_bundle::LoadedBundle {
            discovery_sot: "bundle".into(),
            source: "test".into(),
            operators: vec![crate::operator_bundle::VerifiedOperator {
                slug: "edge-ext".into(),
                host_id: "vps-1".into(),
                org_id: "ext-operator-org-1".into(),
                buyer_base_url: String::new(),
                pubkey: issuer,
                verified: false,
                reason: "unsigned".into(),
            }],
            error: String::new(),
        });
        assert!(admit_capability_token(username, &wire).is_none());
        reset_operator_bundle();
        std::env::remove_var("PROXYHUB_SESSION_CAPABILITY_ISSUER_PUBKEY");
    }

    #[test]
    fn capability_token_bad_prefix_and_payload_rejected() {
        let _guard = CAPABILITY_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        reset_operator_bundle();
        assert!(!looks_like_capability_token("legacy-password"));
        assert!(looks_like_capability_token("phubb1.not-valid-base64"));
        assert!(admit_capability_token("u", "phubb1.").is_none());
        assert!(admit_capability_token("u", "phubb1.%%%%").is_none());

        let username = "w7c-buyer";
        let (issuer, wire) = mint_w7c_token(username);
        std::env::set_var("PROXYHUB_SESSION_CAPABILITY_ISSUER_PUBKEY", &issuer);
        let mut bad = wire.clone();
        // Flip a character in the payload so decode may succeed but sig fails,
        // or decode fails — either way admission is denied.
        let last = bad.pop().unwrap_or('A');
        bad.push(if last == 'A' { 'B' } else { 'A' });
        assert!(admit_capability_token(username, &bad).is_none());
        std::env::remove_var("PROXYHUB_SESSION_CAPABILITY_ISSUER_PUBKEY");
    }

    #[test]
    fn capability_token_unsupported_version_rejected() {
        use base64::engine::general_purpose::URL_SAFE_NO_PAD;
        use base64::Engine;
        let raw = br#"{"v":"2","session_id":"s","offer_hash":"o","buyer_id":"b","expires_at":1,"bandwidth_limit":1,"operator_pubkey":"p","username_hash":"h","issued_at":1,"signature":"s","issuer_pubkey":"p"}"#;
        let wire = format!(
            "{SESSION_CAPABILITY_TOKEN_PREFIX}{}",
            URL_SAFE_NO_PAD.encode(raw)
        );
        assert!(parse_capability_password(&wire).is_none());
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

    #[tokio::test]
    async fn validate_session_rejects_when_usage_counter_exceeds_limit() {
        let redis_url =
            std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
        let Ok(client) = redis::Client::open(redis_url.as_str()) else {
            eprintln!("skip: Redis client open failed");
            return;
        };
        let Ok(mut ping) = client.get_multiplexed_async_connection().await else {
            eprintln!("skip: Redis not available");
            return;
        };
        let pong: Result<String, _> = redis::cmd("PING").query_async(&mut ping).await;
        if pong.ok().as_deref() != Some("PONG") {
            eprintln!("skip: Redis not available");
            return;
        }

        let auth = match SessionAuthenticator::new(&redis_url, 16, 60).await {
            Ok(a) => a,
            Err(e) => {
                eprintln!("skip: authenticator init failed: {e}");
                return;
            }
        };

        let username = format!(
            "entitle-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let session_key = format!("session:{username}");
        let usage_key = format!("session:{username}:usage");
        let session_json = serde_json::json!({
            "user_id": "u1",
            "session_id": "s1",
            "type": "sticky",
            "status": "active",
            "bandwidth_limit": 1000,
            "bandwidth_used": 0,
            "credential_password_hash": credential_hash("secret")
        })
        .to_string();

        let _: () = redis::cmd("SET")
            .arg(&session_key)
            .arg(&session_json)
            .query_async(&mut ping)
            .await
            .expect("set session");
        let _: () = redis::cmd("SET")
            .arg(&usage_key)
            .arg(1000i64)
            .query_async(&mut ping)
            .await
            .expect("set usage");

        let admitted = auth
            .validate_session(&username, true)
            .await
            .expect("validate");
        assert!(
            admitted.is_none(),
            "over-quota usage counter must reject at CONNECT admit"
        );

        let _: () = redis::cmd("DEL")
            .arg(&session_key)
            .arg(&usage_key)
            .query_async(&mut ping)
            .await
            .unwrap_or(());
    }
}

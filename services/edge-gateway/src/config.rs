use std::env;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::RwLock;

fn env_bool(key: &str, default: bool) -> bool {
    env::var(key)
        .ok()
        .and_then(|value| match value.trim().to_ascii_lowercase().as_str() {
            "1" | "true" | "yes" | "on" => Some(true),
            "0" | "false" | "no" | "off" => Some(false),
            _ => None,
        })
        .unwrap_or(default)
}

#[derive(Clone, Debug)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub tunnel_port: u16,
    pub redis_url: String,
    pub sticky_ttl_secs: u64,
    pub jwt_secret: String,
    pub gateway_shared_secret: String,
    pub session_intent_signing_secret: String,
    pub provider_private_key: String,
    pub geoip_db_path: Option<String>,
    pub control_api_url: String,
    /// Explicit opt-in for the deprecated edge-side Groth16 proving/submission path.
    /// Disabled by default because public-testnet settlement is coordinated by control-api batching.
    pub legacy_edge_zk_submission_enabled: bool,
    // Phase 4: Security
    /// ISO 3166-1 alpha-2 codes to block (comma-separated env var GEO_DENY_LIST).
    pub geo_deny_list: Vec<String>,
    /// If non-empty, only these country codes are allowed (GEO_ALLOW_LIST).
    pub geo_allow_list: Vec<String>,
    // Phase 4: Multi-region
    /// Name of the region this instance runs in (REGION env var).
    pub region: Option<String>,
    // P0-A2: Session cache configuration
    /// Maximum number of entries in the session cache (default: 100,000)
    pub session_cache_size: usize,
    /// TTL for session cache entries in seconds (default: 300 = 5 minutes)
    pub session_cache_ttl_secs: u64,

    // P2-12: Per-operation timeouts so a single slow/hung upstream cannot hold
    // a worker thread indefinitely.
    /// TCP connect timeout when dialling upstream proxy nodes (default: 10s).
    pub proxy_connect_timeout_secs: u64,
    /// Idle timeout for proxy tunnels — closed when no bytes flow for this long
    /// in either direction (default: 60s).
    pub proxy_idle_timeout_secs: u64,
    /// HTTP request timeout for Control-API and RPC calls (default: 15s).
    pub rpc_request_timeout_secs: u64,
    /// Maximum requests per minute per session (default: 300).
    pub max_rpm_per_session: Option<u32>,
}

/// Expose debug/operator routes on the public proxy listener (default: off in release/prod).
pub fn debug_routes_enabled() -> bool {
    if let Ok(raw) = env::var("ENABLE_DEBUG_ROUTES") {
        match raw.trim().to_ascii_lowercase().as_str() {
            "1" | "true" | "yes" | "on" => return true,
            "0" | "false" | "no" | "off" => return false,
            _ => {}
        }
    }

    for key in ["APP_ENV", "GO_ENV", "RUST_ENV", "ENVIRONMENT"] {
        if let Ok(raw) = env::var(key) {
            let value = raw.trim().to_ascii_lowercase();
            return matches!(value.as_str(), "development" | "dev" | "local" | "test");
        }
    }

    cfg!(debug_assertions)
}

impl Config {
    pub fn from_env() -> Self {
        let host = env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
        let port = env::var("PORT")
            .unwrap_or_else(|_| "3000".to_string())
            .parse()
            .expect("PORT must be a number");

        let tunnel_port = env::var("TUNNEL_PORT")
            .unwrap_or_else(|_| "4000".to_string())
            .parse()
            .expect("TUNNEL_PORT must be a number");

        let redis_url =
            env::var("REDIS_URL").unwrap_or_else(|_| "redis://localhost:6379".to_string());

        let sticky_ttl_secs = env::var("STICKY_TTL_SECS")
            .unwrap_or_else(|_| "600".to_string())
            .parse()
            .expect("STICKY_TTL_SECS must be a number");

        let jwt_secret = env::var("JWT_SECRET").expect("JWT_SECRET must be set");

        // Dedicated shared secret for edge-gateway -> control-api control-plane calls.
        let gateway_shared_secret = env::var("GATEWAY_SHARED_SECRET")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .expect("GATEWAY_SHARED_SECRET must be set");

        // Session-intent delegation tokens are a separate auth surface from
        // gateway control-plane calls and must use the session secret boundary.
        let session_intent_signing_secret = env::var("SESSION_SECRET")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .expect("SESSION_SECRET must be set");

        let provider_private_key = env::var("PROVIDER_PRIVATE_KEY")
            .expect("PROVIDER_PRIVATE_KEY must be set");

        let geoip_db_path = env::var("GEOIP_DB_PATH").ok().filter(|p| !p.is_empty());

        let geo_deny_list = env::var("GEO_DENY_LIST")
            .unwrap_or_default()
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_uppercase)
            .collect();

        let geo_allow_list = env::var("GEO_ALLOW_LIST")
            .unwrap_or_default()
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_uppercase)
            .collect();

        let region = env::var("REGION").ok();

        // P0-A2: Session cache configuration with defaults
        let session_cache_size = env::var("SESSION_CACHE_SIZE")
            .unwrap_or_else(|_| "100000".to_string())
            .parse()
            .expect("SESSION_CACHE_SIZE must be a positive integer");

        let session_cache_ttl_secs = env::var("SESSION_CACHE_TTL_SECS")
            .unwrap_or_else(|_| "300".to_string())
            .parse()
            .expect("SESSION_CACHE_TTL_SECS must be a positive integer");

        // Control API URL for node registration
        let control_api_url = env::var("CONTROL_API_URL")
            .unwrap_or_else(|_| "http://localhost:8080".to_string());

        let legacy_edge_zk_submission_enabled =
            env_bool("LEGACY_EDGE_ZK_SUBMISSION_ENABLED", false);

        // P2-12: Per-operation timeouts (all configurable via env vars).
        let proxy_connect_timeout_secs = env::var("PROXY_CONNECT_TIMEOUT_SECS")
            .unwrap_or_else(|_| "10".to_string())
            .parse()
            .expect("PROXY_CONNECT_TIMEOUT_SECS must be a positive integer");

        let proxy_idle_timeout_secs = env::var("PROXY_IDLE_TIMEOUT_SECS")
            .unwrap_or_else(|_| "60".to_string())
            .parse()
            .expect("PROXY_IDLE_TIMEOUT_SECS must be a positive integer");

        let rpc_request_timeout_secs = env::var("RPC_REQUEST_TIMEOUT_SECS")
            .unwrap_or_else(|_| "15".to_string())
            .parse()
            .expect("RPC_REQUEST_TIMEOUT_SECS must be a positive integer");

        let max_rpm_per_session = env::var("MAX_RPM_PER_SESSION")
            .ok()
            .and_then(|v| v.parse().ok());

        Self {
            host,
            port,
            tunnel_port,
            redis_url,
            sticky_ttl_secs,
            jwt_secret,
            gateway_shared_secret,
            session_intent_signing_secret,
            provider_private_key,
            geoip_db_path,
            geo_deny_list,
            geo_allow_list,
            region,
            legacy_edge_zk_submission_enabled,
            session_cache_size,
            session_cache_ttl_secs,
            control_api_url,
            proxy_connect_timeout_secs,
            proxy_idle_timeout_secs,
            rpc_request_timeout_secs,
            max_rpm_per_session,
        }
    }

    pub fn socket_addr(&self) -> SocketAddr {
        format!("{}:{}", self.host, self.port)
            .parse()
            .expect("Invalid address format")
    }
}

#[derive(Clone, Debug, Default)]
pub struct DynamicConfig {
    pub treasury_solana: String,
    pub global_bw_limit_mb: u64,
    pub maintenance_mode: bool,
}

pub type SharedDynamicConfig = Arc<RwLock<DynamicConfig>>;

impl DynamicConfig {
    pub async fn update_from_redis(
        redis: &mut redis::aio::Connection,
    ) -> Result<Self, redis::RedisError> {
        use redis::AsyncCommands;

        let treasury: String = redis.hget("sys:config:hash", "treasury_wallet_solana").await.unwrap_or_default();
        let limit_str: String = redis.hget("sys:config:hash", "global_bandwidth_limit").await.unwrap_or_else(|_| "0".to_string());
        let maintenance: bool = redis.hget("sys:config:hash", "maintenance_mode").await.unwrap_or(false);

        let limit = limit_str.parse().unwrap_or(0);

        Ok(Self {
            treasury_solana: treasury,
            global_bw_limit_mb: limit,
            maintenance_mode: maintenance,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn restore_var(key: &str, previous: Option<String>) {
        match previous {
            Some(value) => env::set_var(key, value),
            None => env::remove_var(key),
        }
    }

    #[test]
    fn legacy_edge_zk_submission_defaults_to_disabled() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let previous_jwt = env::var("JWT_SECRET").ok();
        let previous_gateway = env::var("GATEWAY_SHARED_SECRET").ok();
        let previous_session = env::var("SESSION_SECRET").ok();
        let previous_provider = env::var("PROVIDER_PRIVATE_KEY").ok();
        let previous_legacy = env::var("LEGACY_EDGE_ZK_SUBMISSION_ENABLED").ok();

        env::set_var("JWT_SECRET", "test-jwt-secret");
        env::set_var("GATEWAY_SHARED_SECRET", "test-gateway-secret");
        env::set_var("SESSION_SECRET", "test-session-secret");
        env::set_var("PROVIDER_PRIVATE_KEY", "test-provider-key");
        env::remove_var("LEGACY_EDGE_ZK_SUBMISSION_ENABLED");

        let config = Config::from_env();

        restore_var("JWT_SECRET", previous_jwt);
        restore_var("GATEWAY_SHARED_SECRET", previous_gateway);
        restore_var("SESSION_SECRET", previous_session);
        restore_var("PROVIDER_PRIVATE_KEY", previous_provider);
        restore_var("LEGACY_EDGE_ZK_SUBMISSION_ENABLED", previous_legacy);

        assert!(!config.legacy_edge_zk_submission_enabled);
    }

    #[test]
    fn legacy_edge_zk_submission_can_be_enabled_explicitly() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let previous_jwt = env::var("JWT_SECRET").ok();
        let previous_gateway = env::var("GATEWAY_SHARED_SECRET").ok();
        let previous_session = env::var("SESSION_SECRET").ok();
        let previous_provider = env::var("PROVIDER_PRIVATE_KEY").ok();
        let previous_legacy = env::var("LEGACY_EDGE_ZK_SUBMISSION_ENABLED").ok();

        env::set_var("JWT_SECRET", "test-jwt-secret");
        env::set_var("GATEWAY_SHARED_SECRET", "test-gateway-secret");
        env::set_var("SESSION_SECRET", "test-session-secret");
        env::set_var("PROVIDER_PRIVATE_KEY", "test-provider-key");
        env::set_var("LEGACY_EDGE_ZK_SUBMISSION_ENABLED", "true");

        let config = Config::from_env();

        restore_var("JWT_SECRET", previous_jwt);
        restore_var("GATEWAY_SHARED_SECRET", previous_gateway);
        restore_var("SESSION_SECRET", previous_session);
        restore_var("PROVIDER_PRIVATE_KEY", previous_provider);
        restore_var("LEGACY_EDGE_ZK_SUBMISSION_ENABLED", previous_legacy);

        assert!(config.legacy_edge_zk_submission_enabled);
    }

    #[test]
    fn debug_routes_enabled_in_development_env() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let previous = env::var("APP_ENV").ok();
        env::set_var("APP_ENV", "development");
        assert!(debug_routes_enabled());
        match previous {
            Some(value) => env::set_var("APP_ENV", value),
            None => env::remove_var("APP_ENV"),
        }
    }

    #[test]
    fn session_intent_signing_secret_uses_session_secret() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let previous_jwt = env::var("JWT_SECRET").ok();
        let previous_gateway = env::var("GATEWAY_SHARED_SECRET").ok();
        let previous_session = env::var("SESSION_SECRET").ok();
        let previous_provider = env::var("PROVIDER_PRIVATE_KEY").ok();

        env::set_var("JWT_SECRET", "test-jwt-secret");
        env::set_var("GATEWAY_SHARED_SECRET", "test-gateway-secret");
        env::set_var("SESSION_SECRET", "test-session-secret");
        env::set_var("PROVIDER_PRIVATE_KEY", "test-provider-key");

        let config = Config::from_env();

        restore_var("JWT_SECRET", previous_jwt);
        restore_var("GATEWAY_SHARED_SECRET", previous_gateway);
        restore_var("SESSION_SECRET", previous_session);
        restore_var("PROVIDER_PRIVATE_KEY", previous_provider);

        assert_eq!(config.session_intent_signing_secret, "test-session-secret");
    }
}

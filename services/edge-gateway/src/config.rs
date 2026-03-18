use std::env;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Clone, Debug)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub tunnel_port: u16,
    pub redis_url: String,
    pub sticky_ttl_secs: u64,
    pub jwt_secret: String,
    pub provider_private_key: String,
    pub geoip_db_path: Option<String>,
    pub control_api_url: String,
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

        let jwt_secret = env::var("JWT_SECRET").unwrap_or_else(|_| "secret".to_string());

        // In prod, this should fail if missing. For dev, we use a placeholder "00"*32
        let provider_private_key = env::var("PROVIDER_PRIVATE_KEY").unwrap_or_else(|_| {
            "0000000000000000000000000000000000000000000000000000000000000000".to_string()
        });

        let geoip_db_path = env::var("GEOIP_DB_PATH").ok();

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

        Self {
            host,
            port,
            tunnel_port,
            redis_url,
            sticky_ttl_secs,
            jwt_secret,
            provider_private_key,
            geoip_db_path,
            geo_deny_list,
            geo_allow_list,
            region,
            session_cache_size,
            session_cache_ttl_secs,
            control_api_url,
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

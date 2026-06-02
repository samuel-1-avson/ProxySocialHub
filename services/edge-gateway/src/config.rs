use std::collections::HashMap;
use std::env;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Canonical buyer/management port — must match compose, K8s, and docs.
pub const CANONICAL_PORT: u16 = 8090;
/// Canonical provider yamux tunnel port.
pub const CANONICAL_TUNNEL_PORT: u16 = 3128;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EdgeMode {
    /// Default: in-memory registry only (single-pod semantics).
    Single,
    /// Multi-pod: shared Redis directory + owner-pod internal forward (P3.1).
    Colocated,
    /// P3b: buyer ingress and provider tunnel in separate replica pools (ADR 0002).
    Split,
}

impl EdgeMode {
    pub fn from_env() -> Self {
        match env::var("EDGE_MODE")
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "colocated" | "multi" | "multipod" => Self::Colocated,
            "split" | "p3b" => Self::Split,
            _ => Self::Single,
        }
    }

    /// Shared Redis provider directory + cross-pod routing (P3.1 / P3b).
    pub fn uses_multipod_directory(self) -> bool {
        matches!(self, Self::Colocated | Self::Split)
    }
}

/// Process role when [`EdgeMode::Split`] — which listeners this replica runs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EdgeRole {
    /// Buyer HTTP + provider tunnel (default for single/colocated).
    All,
    /// P3b ingress pool: buyer proxy only; tunnel listener off.
    Ingress,
    /// P3b tunnel pool: provider yamux (buyer CONNECT gating in a later slice).
    Tunnel,
}

impl EdgeRole {
    pub fn from_env(edge_mode: EdgeMode) -> Self {
        if edge_mode != EdgeMode::Split {
            return Self::All;
        }
        match env::var("EDGE_ROLE")
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "ingress" | "edge" | "buyer" => Self::Ingress,
            "tunnel" | "tunnel-gw" | "tunnel_gw" | "provider" => Self::Tunnel,
            other if other.is_empty() => {
                panic!("EDGE_MODE=split requires EDGE_ROLE=ingress|tunnel (buyer vs tunnel tier)");
            }
            other => {
                panic!("EDGE_MODE=split: unknown EDGE_ROLE={other:?} (expected ingress|tunnel)")
            }
        }
    }
}

/// Stable pod identity for provider directory and leader election.
pub fn resolve_edge_pod_id() -> String {
    for key in ["EDGE_POD_ID", "HOSTNAME", "POD_NAME"] {
        if let Ok(value) = env::var(key) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }
    format!("ephemeral-{}", uuid::Uuid::new_v4())
}

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
    /// Max concurrent buyer HTTP connections (admission control; default: 8192).
    pub max_concurrent_connections: usize,
    /// Provider score-snapshot refresh interval in ms (default: 100).
    pub score_snapshot_refresh_ms: u64,
    /// Stable id for this gateway replica (P3 directory + leader).
    pub edge_pod_id: String,
    pub edge_mode: EdgeMode,
    /// Listener split when `edge_mode == Split` (see ADR 0002).
    pub edge_role: EdgeRole,
    /// TTL for `eg:provider:owner:*` keys (default: 120s).
    pub provider_directory_ttl_secs: u64,
    /// Peer edge pods for internal forward (`pod_id` → `http://host:port`).
    pub edge_peer_urls: HashMap<String, String>,
    /// P3b tunnel-tier replicas (`pod_id` → `http://host:port` for internal API).
    pub tunnel_gw_urls: HashMap<String, String>,
    /// P4: parallel yamux/TCP sessions per provider (`YAMUX_CONNS_PER_NODE`, default 1, max 16).
    pub yamux_conns_per_node: usize,
    /// P4: `PROVIDER_TRANSPORT` — `yamux` (default) or `quic` (requires `--features quic`).
    pub provider_transport: crate::provider_transport::ProviderTransportKind,
}

/// Parse `EDGE_PEER_URLS=pod-a@http://edge-a:8090,pod-b@http://edge-b:8090`.
pub fn parse_edge_peer_urls() -> HashMap<String, String> {
    let raw = env::var("EDGE_PEER_URLS").unwrap_or_default();
    let mut map = HashMap::new();
    for entry in raw.split(',') {
        let entry = entry.trim();
        if entry.is_empty() {
            continue;
        }
        let Some((pod, url)) = entry.split_once('@') else {
            tracing::warn!(entry, "Skipping EDGE_PEER_URLS entry (expected pod@url)");
            continue;
        };
        let pod = pod.trim();
        let url = url.trim();
        if pod.is_empty() || url.is_empty() {
            continue;
        }
        map.insert(pod.to_string(), url.to_string());
    }
    map
}

/// Parse `TUNNEL_GW_ADDRS=tunnel-a@http://tunnel-a:8090,tunnel-b@http://tunnel-b:8090`.
pub fn parse_tunnel_gw_urls() -> HashMap<String, String> {
    let raw = env::var("TUNNEL_GW_ADDRS").unwrap_or_default();
    let mut map = HashMap::new();
    for entry in raw.split(',') {
        let entry = entry.trim();
        if entry.is_empty() {
            continue;
        }
        let Some((pod, url)) = entry.split_once('@') else {
            tracing::warn!(entry, "Skipping TUNNEL_GW_ADDRS entry (expected pod@url)");
            continue;
        };
        let pod = pod.trim();
        let url = url.trim();
        if pod.is_empty() || url.is_empty() {
            continue;
        }
        map.insert(pod.to_string(), url.to_string());
    }
    map
}

impl Config {
    pub fn peer_base_url(&self, pod_id: &str) -> Option<String> {
        self.edge_peer_urls.get(pod_id).cloned()
    }

    pub fn tunnel_gw_base_url(&self, pod_id: &str) -> Option<String> {
        self.tunnel_gw_urls.get(pod_id).cloned()
    }

    /// Base URL for forwarding to the pod that owns a provider (P3.2 colocated peer, P3b tunnel).
    pub fn owner_forward_base_url(&self, owner_pod_id: &str) -> Option<String> {
        match self.edge_mode {
            EdgeMode::Split => self.tunnel_gw_base_url(owner_pod_id),
            _ => self.peer_base_url(owner_pod_id),
        }
    }

    /// Whether this process should accept provider yamux on `TUNNEL_PORT`.
    pub fn binds_tunnel_listener(&self) -> bool {
        !matches!(
            (self.edge_mode, self.edge_role),
            (EdgeMode::Split, EdgeRole::Ingress)
        )
    }

    /// Whether public buyer CONNECT/WebSocket proxy is served on this process.
    pub fn serves_buyer_connect(&self) -> bool {
        !matches!(
            (self.edge_mode, self.edge_role),
            (EdgeMode::Split, EdgeRole::Tunnel)
        )
    }
}

/// Whether the `/ready` endpoint should require at least one healthy provider
/// before reporting ready. Off by default to avoid readiness flapping on a
/// freshly-started pod that has no providers connected yet (e.g. dev/single-node).
pub fn ready_requires_providers() -> bool {
    env_bool("READY_REQUIRE_PROVIDERS", false)
}

/// POST `/admin/drain` and `/admin/drain/ownership` for graceful pod drain (P3).
/// Enabled when debug routes are on, or explicitly via `ENABLE_POD_DRAIN_ADMIN=true`.
pub fn pod_drain_admin_enabled() -> bool {
    if env_bool("ENABLE_POD_DRAIN_ADMIN", false) {
        return true;
    }
    debug_routes_enabled()
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
        // Canonical buyer/management port (HTTP CONNECT + WS + /metrics + /health + /ready).
        // 8090 matches docker-compose, .env templates, and SYSTEM_ARCHITECTURE docs.
        let port = env::var("PORT")
            .unwrap_or_else(|_| CANONICAL_PORT.to_string())
            .parse()
            .expect("PORT must be a number");

        // Canonical provider tunnel port (yamux). 3128 matches provider-node, CLI,
        // control-api, web, and compose defaults across the repo.
        let tunnel_port = env::var("TUNNEL_PORT")
            .unwrap_or_else(|_| CANONICAL_TUNNEL_PORT.to_string())
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

        let provider_private_key =
            env::var("PROVIDER_PRIVATE_KEY").expect("PROVIDER_PRIVATE_KEY must be set");

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
        let control_api_url =
            env::var("CONTROL_API_URL").unwrap_or_else(|_| "http://localhost:8080".to_string());

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

        let max_concurrent_connections = env::var("MAX_CONCURRENT_CONNECTIONS")
            .unwrap_or_else(|_| "8192".to_string())
            .parse()
            .expect("MAX_CONCURRENT_CONNECTIONS must be a positive integer");

        let score_snapshot_refresh_ms = env::var("SCORE_SNAPSHOT_REFRESH_MS")
            .unwrap_or_else(|_| "100".to_string())
            .parse()
            .expect("SCORE_SNAPSHOT_REFRESH_MS must be a positive integer");

        let edge_pod_id = resolve_edge_pod_id();
        let edge_mode = EdgeMode::from_env();
        let provider_directory_ttl_secs = env::var("PROVIDER_DIRECTORY_TTL_SECS")
            .unwrap_or_else(|_| "120".to_string())
            .parse()
            .expect("PROVIDER_DIRECTORY_TTL_SECS must be a positive integer");

        let edge_peer_urls = parse_edge_peer_urls();
        let tunnel_gw_urls = parse_tunnel_gw_urls();
        let edge_role = EdgeRole::from_env(edge_mode);
        let yamux_conns_per_node = crate::provider_transport::yamux_conns_per_node_from_env();
        let provider_transport = crate::provider_transport::ProviderTransportKind::from_env();

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
            max_concurrent_connections,
            score_snapshot_refresh_ms,
            edge_pod_id,
            edge_mode,
            edge_role,
            provider_directory_ttl_secs,
            edge_peer_urls,
            tunnel_gw_urls,
            yamux_conns_per_node,
            provider_transport,
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

        let treasury: String = redis
            .hget("sys:config:hash", "treasury_wallet_solana")
            .await
            .unwrap_or_default();
        let limit_str: String = redis
            .hget("sys:config:hash", "global_bandwidth_limit")
            .await
            .unwrap_or_else(|_| "0".to_string());
        let maintenance: bool = redis
            .hget("sys:config:hash", "maintenance_mode")
            .await
            .unwrap_or(false);

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
    fn canonical_port_defaults_match_ecosystem() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let prev_jwt = env::var("JWT_SECRET").ok();
        let prev_gateway = env::var("GATEWAY_SHARED_SECRET").ok();
        let prev_session = env::var("SESSION_SECRET").ok();
        let prev_provider = env::var("PROVIDER_PRIVATE_KEY").ok();
        let prev_port = env::var("PORT").ok();
        let prev_tunnel = env::var("TUNNEL_PORT").ok();

        env::set_var("JWT_SECRET", "test-jwt-secret");
        env::set_var("GATEWAY_SHARED_SECRET", "test-gateway-secret");
        env::set_var("SESSION_SECRET", "test-session-secret");
        env::set_var("PROVIDER_PRIVATE_KEY", "test-provider-key");
        env::remove_var("PORT");
        env::remove_var("TUNNEL_PORT");

        let config = Config::from_env();

        restore_var("JWT_SECRET", prev_jwt);
        restore_var("GATEWAY_SHARED_SECRET", prev_gateway);
        restore_var("SESSION_SECRET", prev_session);
        restore_var("PROVIDER_PRIVATE_KEY", prev_provider);
        restore_var("PORT", prev_port);
        restore_var("TUNNEL_PORT", prev_tunnel);

        // These defaults must match docker-compose, .env templates, and K8s.
        assert_eq!(
            config.port, CANONICAL_PORT,
            "buyer/management port must default to canonical value"
        );
        assert_eq!(
            config.tunnel_port, CANONICAL_TUNNEL_PORT,
            "provider tunnel port must default to canonical value"
        );
        assert_eq!(config.control_api_url, "http://localhost:8080");
    }

    #[test]
    fn deploy_manifests_use_canonical_ports() {
        let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let k8s = std::fs::read_to_string(
            manifest_dir.join("../../infra/k8s/edge-gateway-deployment.yaml"),
        )
        .expect("read k8s edge-gateway deployment");
        assert!(
            k8s.contains(&format!("value: \"{}\"", CANONICAL_PORT)),
            "k8s manifest must set PORT to {}",
            CANONICAL_PORT
        );
        assert!(
            k8s.contains(&format!("value: \"{}\"", CANONICAL_TUNNEL_PORT)),
            "k8s manifest must set TUNNEL_PORT to {}",
            CANONICAL_TUNNEL_PORT
        );

        let compose = std::fs::read_to_string(manifest_dir.join("../../docker-compose.yml"))
            .expect("read root docker-compose.yml");
        assert!(
            compose.contains(&format!("PORT={}", CANONICAL_PORT)),
            "docker-compose must expose PORT={} for edge-gateway",
            CANONICAL_PORT
        );
        assert!(
            compose.contains(&format!("TUNNEL_PORT={}", CANONICAL_TUNNEL_PORT)),
            "docker-compose must expose TUNNEL_PORT={} for edge-gateway",
            CANONICAL_TUNNEL_PORT
        );

        let dockerfile = std::fs::read_to_string(manifest_dir.join("Dockerfile"))
            .expect("read production Dockerfile");
        assert!(
            dockerfile.contains(&format!("PORT={}", CANONICAL_PORT)),
            "Dockerfile runtime ENV PORT must match canonical default"
        );
        assert!(
            dockerfile.contains(&format!("TUNNEL_PORT={}", CANONICAL_TUNNEL_PORT)),
            "Dockerfile runtime ENV TUNNEL_PORT must match canonical default"
        );

        let infra_compose = std::fs::read_to_string(
            manifest_dir.join("../../infra/docker-compose/docker-compose.yml"),
        )
        .expect("read infra/docker-compose/docker-compose.yml");
        assert!(
            infra_compose.contains(&format!("PORT={}", CANONICAL_PORT)),
            "infra docker-compose must set PORT={}",
            CANONICAL_PORT
        );
        assert!(
            infra_compose.contains(&format!("TUNNEL_PORT={}", CANONICAL_TUNNEL_PORT)),
            "infra docker-compose must set TUNNEL_PORT={}",
            CANONICAL_TUNNEL_PORT
        );

        let env_example = std::fs::read_to_string(manifest_dir.join("../../.env.example"))
            .expect("read root .env.example");
        assert!(
            env_example.contains(&format!("EDGE_GATEWAY_PORT={}", CANONICAL_PORT)),
            ".env.example must document EDGE_GATEWAY_PORT={}",
            CANONICAL_PORT
        );
        assert!(
            env_example.contains(&format!("localhost:{}", CANONICAL_PORT))
                || env_example.contains(&format!(":{}", CANONICAL_PORT)),
            ".env.example must reference buyer port {}",
            CANONICAL_PORT
        );
    }

    /// ADR D4: default feature set must stay lean (no optional bundles enabled).
    #[test]
    fn default_features_are_lean() {
        assert!(
            cfg!(not(any(
                feature = "legacy-zk",
                feature = "blockchain",
                feature = "pricing",
                feature = "ml",
                feature = "ml-gpu"
            ))),
            "this test runs on the default lean build only"
        );
    }

    #[test]
    fn ready_requires_providers_defaults_off() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let previous = env::var("READY_REQUIRE_PROVIDERS").ok();
        env::remove_var("READY_REQUIRE_PROVIDERS");
        assert!(!ready_requires_providers());
        env::set_var("READY_REQUIRE_PROVIDERS", "true");
        assert!(ready_requires_providers());
        restore_var("READY_REQUIRE_PROVIDERS", previous);
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
    fn edge_mode_split_from_env() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let prev = env::var("EDGE_MODE").ok();
        env::set_var("EDGE_MODE", "split");
        assert_eq!(EdgeMode::from_env(), EdgeMode::Split);
        restore_var("EDGE_MODE", prev);
    }

    #[test]
    fn parse_tunnel_gw_urls_splits_pod_at_url() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let prev = env::var("TUNNEL_GW_ADDRS").ok();
        env::set_var(
            "TUNNEL_GW_ADDRS",
            "tunnel-a@http://tunnel-a:8090,tunnel-b@http://tunnel-b:8090",
        );
        let map = parse_tunnel_gw_urls();
        restore_var("TUNNEL_GW_ADDRS", prev);
        assert_eq!(
            map.get("tunnel-a").map(String::as_str),
            Some("http://tunnel-a:8090")
        );
        assert_eq!(
            map.get("tunnel-b").map(String::as_str),
            Some("http://tunnel-b:8090")
        );
    }

    #[test]
    fn split_ingress_disables_tunnel_listener() {
        let cfg = Config {
            edge_mode: EdgeMode::Split,
            edge_role: EdgeRole::Ingress,
            ..minimal_test_config()
        };
        assert!(cfg.serves_buyer_connect());
        assert!(!cfg.binds_tunnel_listener());
    }

    #[test]
    fn owner_forward_base_url_split_uses_tunnel_gw() {
        let mut tunnel = HashMap::new();
        tunnel.insert("tunnel-a".to_string(), "http://tunnel-a:8090".to_string());
        let cfg = Config {
            edge_mode: EdgeMode::Split,
            edge_role: EdgeRole::Ingress,
            tunnel_gw_urls: tunnel,
            ..minimal_test_config()
        };
        assert_eq!(
            cfg.owner_forward_base_url("tunnel-a").as_deref(),
            Some("http://tunnel-a:8090")
        );
        assert!(cfg.owner_forward_base_url("edge-a").is_none());
    }

    #[test]
    fn owner_forward_base_url_colocated_uses_peer_urls() {
        let mut peers = HashMap::new();
        peers.insert("edge-b".to_string(), "http://edge-b:8090".to_string());
        let cfg = Config {
            edge_mode: EdgeMode::Colocated,
            edge_peer_urls: peers,
            ..minimal_test_config()
        };
        assert_eq!(
            cfg.owner_forward_base_url("edge-b").as_deref(),
            Some("http://edge-b:8090")
        );
        assert!(cfg.owner_forward_base_url("tunnel-a").is_none());
    }

    #[test]
    fn split_tunnel_disables_buyer_connect_serving() {
        let cfg = Config {
            edge_mode: EdgeMode::Split,
            edge_role: EdgeRole::Tunnel,
            ..minimal_test_config()
        };
        assert!(!cfg.serves_buyer_connect());
        assert!(cfg.binds_tunnel_listener());
    }

    fn minimal_test_config() -> Config {
        Config {
            host: "0.0.0.0".to_string(),
            port: CANONICAL_PORT,
            tunnel_port: CANONICAL_TUNNEL_PORT,
            redis_url: "redis://localhost:6379".to_string(),
            sticky_ttl_secs: 600,
            jwt_secret: "x".to_string(),
            gateway_shared_secret: "y".to_string(),
            session_intent_signing_secret: "z".to_string(),
            provider_private_key: "k".to_string(),
            geoip_db_path: None,
            geo_deny_list: vec![],
            geo_allow_list: vec![],
            region: None,
            legacy_edge_zk_submission_enabled: false,
            session_cache_size: 1000,
            session_cache_ttl_secs: 60,
            control_api_url: "http://localhost:8080".to_string(),
            proxy_connect_timeout_secs: 10,
            proxy_idle_timeout_secs: 60,
            rpc_request_timeout_secs: 15,
            max_rpm_per_session: None,
            max_concurrent_connections: 64,
            score_snapshot_refresh_ms: 100,
            edge_pod_id: "test".to_string(),
            edge_mode: EdgeMode::Single,
            edge_role: EdgeRole::All,
            provider_directory_ttl_secs: 120,
            edge_peer_urls: HashMap::new(),
            tunnel_gw_urls: HashMap::new(),
            yamux_conns_per_node: 1,
            provider_transport: crate::provider_transport::ProviderTransportKind::Yamux,
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

use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Provider node configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    /// Control API base URL used for auth and provider lease issuance.
    #[serde(default = "default_control_api_url")]
    pub control_api_url: String,

    /// Primary Edge Gateway address (host:port).
    /// Kept for backward-compatibility; prefer `gateway_addrs` for multi-gateway.
    #[serde(default = "default_gateway_addr")]
    pub gateway_addr: String,

    /// Ordered list of Edge Gateway addresses to try on connect/reconnect.
    /// The node cycles through this list on each reconnect attempt so a single
    /// gateway outage does not take the provider offline.
    /// If non-empty, `gateway_addr` is used as an implicit first entry unless
    /// already present in this list.
    #[serde(default)]
    pub gateway_addrs: Vec<String>,

    /// JWT token for authentication.
    #[serde(default)]
    pub jwt_token: String,

    /// API key (alternative to JWT).
    #[serde(default)]
    pub api_key: String,

    /// Legacy fallback node identifier.
    /// Heartbeats now derive their node identity from the authenticated runtime user.
    #[serde(default)]
    pub node_id: String,

    /// Base58 Ed25519 signing key for provider-authored heartbeat proofs.
    /// Accepts either a 32-byte seed or a 64-byte keypair encoded as base58.
    #[serde(default)]
    pub provider_signing_key: String,

    /// Use TLS for the gateway tunnel.
    #[serde(default)]
    pub use_tls: bool,

    /// Skip TLS certificate verification (development only).
    #[serde(default)]
    pub tls_skip_verify: bool,

    /// Path to a custom CA certificate (PEM).
    #[serde(default)]
    pub tls_cert_path: String,

    /// Maximum concurrent connections this node will accept.
    #[serde(default = "default_max_connections")]
    pub max_connections: u32,

    /// Bandwidth limit in Mbps.
    #[serde(default = "default_bandwidth_limit")]
    pub bandwidth_limit_mbps: u32,

    /// Ports this node is willing to proxy to.
    #[serde(default = "default_allowed_ports")]
    pub allowed_ports: Vec<u16>,

    /// Hosts this node will refuse to proxy to.
    #[serde(default)]
    pub blocked_hosts: Vec<String>,

    /// Enable the local metrics HTTP server.
    #[serde(default = "default_true")]
    pub metrics_enabled: bool,

    /// Port for the local metrics HTTP server.
    #[serde(default = "default_metrics_port")]
    pub metrics_port: u16,

    /// Reconnect interval after a connection loss.
    #[serde(default = "default_reconnect_interval", with = "duration_secs")]
    pub reconnect_interval: Duration,

    /// Connection timeout.
    #[serde(default = "default_connect_timeout", with = "duration_secs")]
    pub connect_timeout: Duration,

    /// Type of network connection (e.g., residential, data-center).
    #[serde(default = "default_connection_type")]
    pub connection_type: String,

    /// P4: parallel yamux tunnels to the gateway (must match gateway `YAMUX_CONNS_PER_NODE`).
    #[serde(default = "default_yamux_conns_per_node")]
    pub yamux_conns_per_node: usize,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            control_api_url: default_control_api_url(),
            gateway_addr: default_gateway_addr(),
            gateway_addrs: Vec::new(),
            jwt_token: String::new(),
            api_key: String::new(),
            node_id: String::new(),
            provider_signing_key: String::new(),
            use_tls: false,
            tls_skip_verify: false,
            tls_cert_path: String::new(),
            max_connections: default_max_connections(),
            bandwidth_limit_mbps: default_bandwidth_limit(),
            allowed_ports: default_allowed_ports(),
            blocked_hosts: Vec::new(),
            metrics_enabled: true,
            metrics_port: default_metrics_port(),
            reconnect_interval: default_reconnect_interval(),
            connect_timeout: default_connect_timeout(),
            connection_type: default_connection_type(),
            yamux_conns_per_node: default_yamux_conns_per_node(),
        }
    }
}

fn default_yamux_conns_per_node() -> usize {
    1
}

/// Provider → gateway wire protocol (mirrors edge-gateway `PROVIDER_TRANSPORT`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderTransport {
    Yamux,
    Quic,
}

impl ProviderTransport {
    pub fn from_env() -> Self {
        match std::env::var("PROVIDER_TRANSPORT")
            .ok()
            .map(|v| v.trim().to_ascii_lowercase())
            .as_deref()
        {
            Some("quic" | "http3") => Self::Quic,
            _ => Self::Yamux,
        }
    }

    pub fn quic_requested(&self) -> bool {
        matches!(self, Self::Quic)
    }
}

/// Read `YAMUX_CONNS_PER_NODE` (1–16). Config file value is the default when unset.
pub fn yamux_conns_per_node_from_env() -> Option<usize> {
    const MAX: usize = 16;
    let raw = std::env::var("YAMUX_CONNS_PER_NODE").ok()?;
    match raw.trim().parse::<usize>() {
        Ok(0) => Some(1),
        Ok(n) => Some(n.min(MAX).max(1)),
        Err(_) => None,
    }
}

impl Config {
    /// Load configuration from a TOML file.  Falls back to defaults if the file
    /// does not exist.
    pub fn load(path: &str) -> anyhow::Result<Self> {
        let contents = match std::fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => return Ok(Self::default()),
        };
        let cfg: Config = toml::from_str(&contents)?;
        Ok(cfg)
    }

    /// Platform-specific path for operator config (outside git repos).
    pub fn default_config_path() -> std::path::PathBuf {
        if let Some(dir) = dirs::config_dir() {
            return dir.join("proxyhubb").join("provider.toml");
        }
        std::path::PathBuf::from("provider.toml")
    }

    pub fn effective_yamux_conns_per_node(&self) -> usize {
        yamux_conns_per_node_from_env().unwrap_or(self.yamux_conns_per_node)
    }

    pub fn save(&self, path: &std::path::Path) -> anyhow::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let body = toml::to_string_pretty(self)?;
        std::fs::write(path, body)?;
        Ok(())
    }
}

// ── Defaults ────────────────────────────────────────────────────────

fn default_gateway_addr() -> String {
    "localhost:3128".to_string()
}
fn default_control_api_url() -> String {
    "http://localhost:18080".to_string()
}
fn default_max_connections() -> u32 {
    500
}
fn default_bandwidth_limit() -> u32 {
    100
}
fn default_allowed_ports() -> Vec<u16> {
    vec![80, 443, 8080, 8443]
}
fn default_true() -> bool {
    true
}
fn default_metrics_port() -> u16 {
    9090
}
fn default_reconnect_interval() -> Duration {
    Duration::from_secs(30)
}
fn default_connect_timeout() -> Duration {
    Duration::from_secs(10)
}
fn default_connection_type() -> String {
    "residential".to_string()
}

/// Serde helper: serialize/deserialize `Duration` as seconds (u64).
mod duration_secs {
    use serde::{self, Deserialize, Deserializer, Serializer};
    use std::time::Duration;

    pub fn serialize<S>(d: &Duration, s: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        s.serialize_u64(d.as_secs())
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Duration, D::Error>
    where
        D: Deserializer<'de>,
    {
        let secs = u64::deserialize(deserializer)?;
        Ok(Duration::from_secs(secs))
    }
}

#[cfg(test)]
mod transport_tests {
    use super::ProviderTransport;

    #[test]
    fn provider_transport_from_env() {
        std::env::remove_var("PROVIDER_TRANSPORT");
        assert_eq!(ProviderTransport::from_env(), ProviderTransport::Yamux);

        std::env::set_var("PROVIDER_TRANSPORT", "quic");
        assert_eq!(ProviderTransport::from_env(), ProviderTransport::Quic);

        std::env::remove_var("PROVIDER_TRANSPORT");
    }
}

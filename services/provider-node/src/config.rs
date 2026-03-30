use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Provider node configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
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

    /// Unique node identifier (assigned during registration).
    #[serde(default)]
    pub node_id: String,

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
}

impl Default for Config {
    fn default() -> Self {
        Self {
            gateway_addr: default_gateway_addr(),
            gateway_addrs: Vec::new(),
            jwt_token: String::new(),
            api_key: String::new(),
            node_id: String::new(),
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
        }
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
}

// ── Defaults ────────────────────────────────────────────────────────

fn default_gateway_addr() -> String {
    "localhost:4000".to_string()
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

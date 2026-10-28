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
            use_tls: true,
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
        Ok(n) => Some(n.clamp(1, MAX)),
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
        crate::paths::config_file()
    }

    pub fn effective_yamux_conns_per_node(&self) -> usize {
        yamux_conns_per_node_from_env().unwrap_or(self.yamux_conns_per_node)
    }

    pub fn save(&self, path: &std::path::Path) -> anyhow::Result<()> {
        let body = toml::to_string_pretty(self)?;
        write_private(path, &body)?;
        Ok(())
    }

    /// Lines describing where this config sends traffic and whether it verifies the
    /// gateway. Shown before a config file is installed so an operator can spot a
    /// redirected gateway or disabled TLS verification. Never includes credentials.
    pub fn install_summary(&self) -> String {
        let mut gateways = vec![self.gateway_addr.clone()];
        for g in &self.gateway_addrs {
            if !gateways.contains(g) {
                gateways.push(g.clone());
            }
        }
        let mut out = String::new();
        out.push_str(&format!("  control_api_url = {}\n", self.control_api_url));
        out.push_str(&format!("  gateway         = {}\n", gateways.join(", ")));
        out.push_str(&format!("  use_tls         = {}\n", self.use_tls));
        out.push_str(&format!("  tls_skip_verify = {}\n", self.tls_skip_verify));
        out.push_str(&format!("  allowed_ports   = {:?}\n", self.allowed_ports));
        if self.tls_skip_verify {
            out.push_str(
                "  WARNING: tls_skip_verify = true turns off gateway certificate checks.\n",
            );
        }
        out
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

/// True when the gateway address is a public host/IP (not localhost / docker service).
/// Used to default TLS on for production while keeping local dev on plain TCP.
pub fn gateway_looks_public(addr: &str) -> bool {
    let host = addr
        .split(':')
        .next()
        .unwrap_or("")
        .trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_ascii_lowercase();
    if host.is_empty() {
        return false;
    }
    if host == "localhost" || host == "127.0.0.1" || host == "::1" {
        return false;
    }
    // Docker / compose service names (no dot) are internal.
    if !host.contains('.') {
        return false;
    }
    // Private IPv4 ranges are treated as internal.
    if let Ok(ip) = host.parse::<std::net::Ipv4Addr>() {
        return !(ip.is_private() || ip.is_loopback() || ip.is_link_local());
    }
    true
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

/// Writes a file that holds credentials so that only its owner can read it.
///
/// On Unix the file is created 0600, or tightened to 0600 before any new contents go in if it
/// already existed with looser permissions, and directories created for it are 0700. Without
/// this the umask decides, and the usual 022 leaves the provider token and signing key readable
/// by every local user. A directory that already exists is left as it is. On Windows the file
/// inherits the ACL of its folder, which under `%APPDATA%` is private to the user.
pub fn write_private(path: &std::path::Path, contents: &str) -> std::io::Result<()> {
    use std::io::Write;

    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
        create_private_dirs(parent)?;
    }
    #[cfg(unix)]
    let mut file = {
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)?;
        // `mode` only applies when the file is created, so tighten one that already existed.
        file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
        file
    };
    #[cfg(not(unix))]
    let mut file = std::fs::File::create(path)?;
    file.write_all(contents.as_bytes())
}

#[cfg(unix)]
fn create_private_dirs(dir: &std::path::Path) -> std::io::Result<()> {
    use std::os::unix::fs::DirBuilderExt;
    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(dir)
}

#[cfg(not(unix))]
fn create_private_dirs(dir: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)
}

#[cfg(test)]
mod private_file_tests {
    use super::{write_private, Config};
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// A fresh scratch directory that does not exist yet, so a test can see what gets created.
    fn scratch(label: &str) -> PathBuf {
        static N: AtomicU32 = AtomicU32::new(0);
        std::env::temp_dir().join(format!(
            "phub-private-{label}-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::SeqCst)
        ))
    }

    #[test]
    fn contents_replace_the_old_file_completely() {
        let dir = scratch("replace");
        let path = dir.join("provider.toml");
        write_private(&path, "a much longer first version").unwrap();
        write_private(&path, "short").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "short");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn config_save_creates_missing_directories() {
        let dir = scratch("save");
        let path = dir.join("nested").join("provider.toml");
        Config::default().save(&path).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains("control_api_url"), "{text}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    fn mode(path: &std::path::Path) -> u32 {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    #[cfg(unix)]
    #[test]
    fn a_new_file_and_the_directory_made_for_it_are_owner_only() {
        let dir = scratch("new");
        let path = dir.join("provider.toml");
        write_private(&path, "api_key = \"secret\"").unwrap();
        assert_eq!(mode(&path), 0o600, "file");
        assert_eq!(mode(&dir), 0o700, "directory created for it");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn an_existing_world_readable_file_is_tightened_before_the_secret_goes_in() {
        use std::os::unix::fs::PermissionsExt;
        let dir = scratch("tighten");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("provider.toml");
        std::fs::write(&path, "old").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        write_private(&path, "api_key = \"secret\"").unwrap();
        assert_eq!(mode(&path), 0o600);
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "api_key = \"secret\""
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn a_directory_that_already_exists_is_left_as_it_is() {
        use std::os::unix::fs::PermissionsExt;
        let dir = scratch("keepdir");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
        write_private(&dir.join("provider.toml"), "x").unwrap();
        assert_eq!(
            mode(&dir),
            0o755,
            "must not chmod a directory it did not create"
        );
        let _ = std::fs::remove_dir_all(&dir);
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

#[cfg(test)]
mod install_summary_tests {
    use super::Config;

    #[test]
    fn summary_shows_routing_settings_and_never_credentials() {
        let mut cfg = Config::default();
        cfg.control_api_url = "https://api.evil.test".to_string();
        cfg.gateway_addr = "gw-a.evil.test:3128".to_string();
        cfg.gateway_addrs = vec![
            "gw-a.evil.test:3128".to_string(),
            "gw-b.evil.test:3128".to_string(),
        ];
        cfg.tls_skip_verify = true;
        cfg.api_key = "SECRET-API-KEY".to_string();
        cfg.jwt_token = "SECRET-JWT".to_string();
        cfg.provider_signing_key = "SECRET-SIGNING-KEY".to_string();

        let s = cfg.install_summary();
        assert!(s.contains("https://api.evil.test"));
        assert!(
            s.contains("gw-a.evil.test:3128, gw-b.evil.test:3128"),
            "{s}"
        );
        assert!(s.contains("tls_skip_verify = true"));
        assert!(s.contains("WARNING"));
        assert!(!s.contains("SECRET"), "summary leaked a credential: {s}");
    }

    #[test]
    fn summary_has_no_warning_when_tls_is_verified() {
        let cfg = Config::default();
        assert!(!cfg.install_summary().contains("WARNING"));
    }
}

#[cfg(test)]
mod config_contract_tests {
    use super::Config;

    #[test]
    fn register_config_serializes_required_provider_contract_fields() {
        let generated = crate::proofs::ProviderSigner::generate().unwrap();
        let mut cfg = Config::default();
        cfg.control_api_url = "https://api.proxyhubb.test".to_string();
        cfg.gateway_addr = "gw.proxyhubb.test:3128".to_string();
        cfg.api_key = "provider-token-contract-test".to_string();
        cfg.node_id = "node-contract-test".to_string();
        cfg.provider_signing_key = generated.secret_base58.clone();
        cfg.connection_type = "residential".to_string();
        cfg.use_tls = true;

        let body = toml::to_string_pretty(&cfg).unwrap();
        let parsed: toml::Value = toml::from_str(&body).unwrap();

        assert_eq!(
            parsed["control_api_url"].as_str(),
            Some("https://api.proxyhubb.test")
        );
        assert_eq!(
            parsed["gateway_addr"].as_str(),
            Some("gw.proxyhubb.test:3128")
        );
        assert_eq!(parsed["jwt_token"].as_str(), Some(""));
        assert_eq!(
            parsed["api_key"].as_str(),
            Some("provider-token-contract-test")
        );
        assert_eq!(parsed["node_id"].as_str(), Some("node-contract-test"));
        assert_eq!(
            parsed["provider_signing_key"].as_str(),
            Some(generated.secret_base58.as_str())
        );
        assert_eq!(parsed["connection_type"].as_str(), Some("residential"));
        assert_eq!(parsed["use_tls"].as_bool(), Some(true));
        assert_eq!(parsed["metrics_port"].as_integer(), Some(9090));

        let parsed_cfg: Config = toml::from_str(&body).unwrap();
        assert_eq!(parsed_cfg.provider_signing_key, generated.secret_base58);
    }
}

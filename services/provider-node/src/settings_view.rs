//! `provider-node config show --json`: this computer's node settings, for reading.
//!
//! No credential is ever included, and no value of one: only whether a key is set. The desktop
//! app (apps/provider-app) shows this and cannot change any of it.
//!
//! Two of the numbers deserve care in how they are described. `max_connections` and
//! `bandwidth_limit_mbps` are announced to ProxyHubb in the node's capabilities (and the gateway
//! checks the lease against them); the node itself does not use them to cap or slow any traffic.
//! They are what this computer OFFERS, not a limit on it.

use crate::config::{Config, ProviderTransport};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SettingsView {
    pub config_path: String,
    /// A `provider.toml` exists. When it does not, the rest is the built-in defaults.
    pub config_present: bool,
    pub control_api_url: String,
    /// Gateway addresses in the order the node tries them.
    pub gateways: Vec<String>,
    /// "yamux" or "quic".
    pub transport: String,
    pub use_tls: bool,
    /// Gateway certificate checks are turned off. Only ever for development.
    pub tls_skip_verify: bool,
    /// Offered to ProxyHubb, not enforced by the node.
    pub max_connections: u32,
    pub bandwidth_limit_mbps: u32,
    /// The only ports the node will open connections to.
    pub allowed_ports: Vec<u16>,
    pub blocked_hosts: Vec<String>,
    pub connection_type: String,
    pub metrics_port: u16,
    pub has_api_key: bool,
    pub has_signing_key: bool,
}

pub fn view_of(cfg: &Config, config_path: &str, config_present: bool) -> SettingsView {
    let mut gateways: Vec<String> = Vec::new();
    for g in std::iter::once(&cfg.gateway_addr).chain(cfg.gateway_addrs.iter()) {
        let g = g.trim();
        if !g.is_empty() && !gateways.iter().any(|x| x == g) {
            gateways.push(g.to_string());
        }
    }
    SettingsView {
        config_path: config_path.to_string(),
        config_present,
        control_api_url: cfg.control_api_url.clone(),
        gateways,
        transport: match ProviderTransport::from_env() {
            ProviderTransport::Quic => "quic".to_string(),
            ProviderTransport::Yamux => "yamux".to_string(),
        },
        use_tls: cfg.use_tls,
        tls_skip_verify: cfg.tls_skip_verify,
        max_connections: cfg.max_connections,
        bandwidth_limit_mbps: cfg.bandwidth_limit_mbps,
        allowed_ports: cfg.allowed_ports.clone(),
        blocked_hosts: cfg.blocked_hosts.clone(),
        connection_type: cfg.connection_type.clone(),
        metrics_port: cfg.metrics_port,
        has_api_key: !cfg.api_key.trim().is_empty() || !cfg.jwt_token.trim().is_empty(),
        has_signing_key: !cfg.provider_signing_key.trim().is_empty(),
    }
}

pub fn collect(config_path: &std::path::Path) -> SettingsView {
    let path = config_path.to_string_lossy().into_owned();
    let cfg = Config::load(&path).unwrap_or_default();
    view_of(&cfg, &path, config_path.is_file())
}

pub fn print_human(v: &SettingsView) {
    println!("--- Node settings ---");
    println!(
        "Config:           {}{}",
        v.config_path,
        if v.config_present { "" } else { " (not found)" }
    );
    println!("Control API:      {}", v.control_api_url);
    println!("Gateways:         {}", v.gateways.join(", "));
    println!("Transport:        {} (tls: {})", v.transport, v.use_tls);
    println!(
        "Offers:           up to {} connections, {} Mbps",
        v.max_connections, v.bandwidth_limit_mbps
    );
    println!("Allowed ports:    {:?}", v.allowed_ports);
    println!(
        "Blocked hosts:    {}",
        if v.blocked_hosts.is_empty() {
            "none".to_string()
        } else {
            v.blocked_hosts.join(", ")
        }
    );
    println!(
        "Key set:          {}   Signing key set: {}",
        v.has_api_key, v.has_signing_key
    );
    if v.tls_skip_verify {
        println!("WARNING: tls_skip_verify is on: gateway certificate checks are off.");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn cfg_with_secrets() -> Config {
        Config {
            api_key: "ph_live_SECRET_API_KEY".into(),
            jwt_token: "eyJ.SECRET.JWT".into(),
            provider_signing_key: "SECRETSIGNINGKEY".into(),
            node_id: "48d27c5c-4383-4424-ba88-1ded99596a59".into(),
            gateway_addr: "proxy.proxyhubb.com:3128".into(),
            gateway_addrs: vec![
                "proxy.proxyhubb.com:8443".into(),
                "proxy.proxyhubb.com:3128".into(),
                "  ".into(),
            ],
            blocked_hosts: vec!["blocked.example".into()],
            ..Config::default()
        }
    }

    /// The view goes to a window and may be pasted into a support request.
    #[test]
    fn no_credential_value_and_no_account_identifier_is_in_the_view() {
        let v = view_of(&cfg_with_secrets(), "/p/provider.toml", true);
        let text = serde_json::to_string(&v).unwrap();
        for secret in [
            "ph_live_SECRET_API_KEY",
            "eyJ.SECRET.JWT",
            "SECRETSIGNINGKEY",
            "48d27c5c-4383-4424-ba88-1ded99596a59",
        ] {
            assert!(!text.contains(secret), "{secret} leaked: {text}");
        }
        assert!(
            v.has_api_key && v.has_signing_key,
            "but it says they are set"
        );
    }

    #[test]
    fn gateways_are_in_order_without_blanks_or_repeats() {
        let v = view_of(&cfg_with_secrets(), "/p/provider.toml", true);
        assert_eq!(
            v.gateways,
            vec!["proxy.proxyhubb.com:3128", "proxy.proxyhubb.com:8443"]
        );
    }

    #[test]
    fn a_jwt_alone_counts_as_a_key_being_set_and_nothing_set_does_not() {
        let jwt_only = Config {
            jwt_token: "x".into(),
            ..Config::default()
        };
        assert!(view_of(&jwt_only, "p", true).has_api_key);
        let bare = view_of(&Config::default(), "p", false);
        assert!(!bare.has_api_key && !bare.has_signing_key && !bare.config_present);
    }

    #[test]
    fn a_missing_file_gives_the_defaults_and_says_it_is_missing() {
        let v = collect(std::path::Path::new("/definitely/not/here/provider.toml"));
        assert!(!v.config_present);
        assert_eq!(v.allowed_ports, vec![80, 443, 8080, 8443]);
    }

    /// The desktop app (apps/provider-app, src-tauri/src/settings_view.rs) reads exactly these.
    #[test]
    fn settings_json_keeps_the_fields_the_desktop_app_reads() {
        let v: Value =
            serde_json::to_value(view_of(&cfg_with_secrets(), "/p/provider.toml", true)).unwrap();
        for key in [
            "config_present",
            "control_api_url",
            "gateways",
            "transport",
            "use_tls",
            "tls_skip_verify",
            "max_connections",
            "bandwidth_limit_mbps",
            "allowed_ports",
            "blocked_hosts",
            "connection_type",
            "metrics_port",
            "has_api_key",
            "has_signing_key",
        ] {
            assert!(v.get(key).is_some(), "{key} is missing");
        }
        assert_eq!(v["max_connections"], 500);
        assert_eq!(v["bandwidth_limit_mbps"], 100);
    }
}

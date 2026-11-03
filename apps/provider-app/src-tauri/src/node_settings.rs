//! This computer's node settings, for reading: the parsing of `provider-node config show --json`.
//!
//! The app shows them and cannot change them (decided: read-only in v1). No key or token is in
//! the report, only whether one is set, and `provider-node`'s own tests pin that.
//!
//! Two of the numbers are easy to misread as limits. `max_connections` and
//! `bandwidth_limit_mbps` are announced to ProxyHubb as what this computer OFFERS; the node does
//! not use them to cap or slow any traffic. The window says so (see `Details.tsx`).

use serde::{Deserialize, Serialize};

use crate::account::first_json;

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct NodeSettings {
    #[serde(default)]
    pub config_path: String,
    #[serde(default)]
    pub gateways: Vec<String>,
    #[serde(default)]
    pub transport: String,
    #[serde(default)]
    pub use_tls: bool,
    /// Gateway certificate checks are off. Only ever for development.
    #[serde(default)]
    pub tls_skip_verify: bool,
    #[serde(default)]
    pub max_connections: u32,
    #[serde(default)]
    pub bandwidth_limit_mbps: u32,
    #[serde(default)]
    pub allowed_ports: Vec<u16>,
    #[serde(default)]
    pub blocked_hosts: Vec<String>,
    #[serde(default)]
    pub connection_type: String,
}

pub fn parse_node_settings(text: &str) -> Result<NodeSettings, String> {
    first_json(text, "config show")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The shape `config show --json` really prints (values from a real run).
    const REAL: &str = r#"{
      "config_path": "C:/p/provider.toml", "config_present": true,
      "control_api_url": "https://api.proxyhubb.com",
      "gateways": ["proxy.proxyhubb.com:3128", "proxy.proxyhubb.com:8443"],
      "transport": "yamux", "use_tls": true, "tls_skip_verify": false,
      "max_connections": 500, "bandwidth_limit_mbps": 100,
      "allowed_ports": [80, 443, 8080, 8443], "blocked_hosts": [],
      "connection_type": "residential", "metrics_port": 9090,
      "has_api_key": true, "has_signing_key": true
    }"#;

    #[test]
    fn a_real_report_is_read() {
        let s = parse_node_settings(REAL).unwrap();
        assert_eq!(s.gateways.len(), 2);
        assert_eq!((s.max_connections, s.bandwidth_limit_mbps), (500, 100));
        assert_eq!(s.allowed_ports, vec![80, 443, 8080, 8443]);
        assert_eq!(s.connection_type, "residential");
        assert!(s.use_tls && !s.tls_skip_verify);
        assert_eq!(s.config_path, "C:/p/provider.toml");
    }

    #[test]
    fn text_around_the_json_is_tolerated_and_garbage_is_an_error() {
        assert!(parse_node_settings(&format!("note\n{REAL}\n")).is_ok());
        for bad in ["", "nothing", "{", "[1]"] {
            assert!(parse_node_settings(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn fields_missing_from_an_older_node_become_empty_not_a_crash() {
        let s = parse_node_settings("{}").unwrap();
        assert!(s.gateways.is_empty() && s.allowed_ports.is_empty());
        assert!(!s.tls_skip_verify);
    }

    /// What goes to the window is exactly these fields: nothing from the report that is not
    /// listed (a key name, a control API address) is passed along.
    #[test]
    fn only_the_listed_fields_reach_the_window() {
        let v = serde_json::to_value(parse_node_settings(REAL).unwrap()).unwrap();
        let mut keys: Vec<_> = v.as_object().unwrap().keys().cloned().collect();
        keys.sort();
        assert_eq!(
            keys,
            [
                "allowed_ports",
                "bandwidth_limit_mbps",
                "blocked_hosts",
                "config_path",
                "connection_type",
                "gateways",
                "max_connections",
                "tls_skip_verify",
                "transport",
                "use_tls"
            ]
        );
    }
}

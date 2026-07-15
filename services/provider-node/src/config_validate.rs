use crate::config::{Config, ProviderTransport};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use std::time::Duration;

const KNOWN_KEYS: &[&str] = &[
    "control_api_url",
    "gateway_addr",
    "gateway_addrs",
    "jwt_token",
    "api_key",
    "node_id",
    "provider_signing_key",
    "use_tls",
    "tls_skip_verify",
    "tls_cert_path",
    "max_connections",
    "bandwidth_limit_mbps",
    "allowed_ports",
    "blocked_hosts",
    "metrics_enabled",
    "metrics_port",
    "reconnect_interval",
    "connect_timeout",
    "connection_type",
    "yamux_conns_per_node",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigValidationReport {
    pub config_path: String,
    pub checks: Vec<ConfigValidationCheck>,
    pub ok: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigValidationCheck {
    pub id: String,
    pub ok: bool,
    pub severity: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remediation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remediation_code: Option<String>,
}

pub fn run(config_path: PathBuf) -> ConfigValidationReport {
    let path_str = config_path.to_string_lossy().into_owned();
    let mut checks = Vec::new();

    if !config_path.exists() {
        push(
            &mut checks,
            "config_file",
            false,
            "error",
            format!("Missing config at {path_str}"),
            Some("Run provider-node register --api-key <PROVIDER_TOKEN> --config provider.toml, or download a provider.toml from the dashboard."),
            Some("config_missing"),
        );
        return finish(path_str, checks);
    }

    push(
        &mut checks,
        "config_file",
        true,
        "info",
        format!("Found {path_str}"),
        None,
        None,
    );

    let contents = match std::fs::read_to_string(&config_path) {
        Ok(contents) => contents,
        Err(err) => {
            push(
                &mut checks,
                "config_read",
                false,
                "error",
                format!("Cannot read config: {err}"),
                Some("Check file permissions and rerun the command from a terminal that can read provider.toml."),
                Some("config_unreadable"),
            );
            return finish(path_str, checks);
        }
    };

    let cfg: Config = match toml::from_str(&contents) {
        Ok(cfg) => {
            push(
                &mut checks,
                "config_parse",
                true,
                "info",
                "Configuration parses",
                None,
                None,
            );
            cfg
        }
        Err(err) => {
            push(
                &mut checks,
                "config_parse",
                false,
                "error",
                format!("Invalid TOML: {err}"),
                Some("Fix the TOML syntax near the reported line, or regenerate provider.toml from the dashboard."),
                Some("config_parse_failed"),
            );
            return finish(path_str, checks);
        }
    };

    validate_unknown_keys(&contents, &mut checks);
    validate_credentials(&cfg, &mut checks);
    validate_control_api_url(&cfg, &mut checks);
    validate_gateways(&cfg, &mut checks);
    validate_signing_key(&cfg, &mut checks);
    validate_tls(&cfg, &mut checks);
    validate_limits(&cfg, &mut checks);
    validate_runtime(&cfg, &mut checks);
    validate_transport_env(&cfg, &mut checks);

    finish(path_str, checks)
}

fn validate_unknown_keys(contents: &str, checks: &mut Vec<ConfigValidationCheck>) {
    let Ok(value) = toml::from_str::<toml::Value>(contents) else {
        return;
    };
    let Some(table) = value.as_table() else {
        return;
    };
    let known: HashSet<&str> = KNOWN_KEYS.iter().copied().collect();
    for key in table.keys().filter(|key| !known.contains(key.as_str())) {
        push(
            checks,
            "unknown_field",
            false,
            "warn",
            format!("Unknown top-level config field `{key}`"),
            Some("Check for a typo. provider-node ignores unknown fields, so the intended setting may not apply."),
            Some("unknown_config_field"),
        );
    }
}

fn validate_credentials(cfg: &Config, checks: &mut Vec<ConfigValidationCheck>) {
    let has_api_key = !cfg.api_key.trim().is_empty();
    let has_jwt = !cfg.jwt_token.trim().is_empty();
    if !has_api_key && !has_jwt {
        push(
            checks,
            "credentials",
            false,
            "error",
            "Missing provider credentials: set api_key or jwt_token",
            Some("Create a provider API token in the dashboard, then set api_key = \"<token>\" in provider.toml."),
            Some("credentials_missing"),
        );
    } else if has_api_key {
        push(
            checks,
            "credentials",
            true,
            "info",
            "api_key present",
            None,
            None,
        );
    } else {
        push(
            checks,
            "credentials",
            true,
            "warn",
            "jwt_token present; api_key is preferred for long-running nodes",
            Some("Replace jwt_token with api_key when possible so the node can refresh gateway access safely."),
            Some("jwt_token_only"),
        );
    }
}

fn validate_control_api_url(cfg: &Config, checks: &mut Vec<ConfigValidationCheck>) {
    let raw = cfg.control_api_url.trim();
    if raw.is_empty() {
        push(
            checks,
            "control_api_url",
            false,
            "error",
            "control_api_url is empty",
            Some("Set control_api_url to your ProxyHubb API URL, for example http://localhost:18080 for local dev."),
            Some("control_api_url_missing"),
        );
        return;
    }

    match reqwest::Url::parse(raw) {
        Ok(url) if matches!(url.scheme(), "http" | "https") && url.host_str().is_some() => push(
            checks,
            "control_api_url",
            true,
            "info",
            format!("control_api_url is valid ({raw})"),
            None,
            None,
        ),
        Ok(url) => push(
            checks,
            "control_api_url",
            false,
            "error",
            format!("control_api_url must be http(s) with a host, got `{}`", url),
            Some("Use a full URL such as http://localhost:18080 or https://api.proxyhubb.com."),
            Some("control_api_url_invalid"),
        ),
        Err(err) => push(
            checks,
            "control_api_url",
            false,
            "error",
            format!("Invalid control_api_url: {err}"),
            Some("Use a full URL such as http://localhost:18080 or https://api.proxyhubb.com."),
            Some("control_api_url_invalid"),
        ),
    }
}

fn validate_gateways(cfg: &Config, checks: &mut Vec<ConfigValidationCheck>) {
    let gateways = gateway_list(cfg);
    if gateways.is_empty() {
        push(
            checks,
            "gateway",
            false,
            "error",
            "No gateway address configured",
            Some("Set gateway_addr = \"<host>:3128\" or gateway_addrs = [\"<host>:3128\"]."),
            Some("gateway_missing"),
        );
        return;
    }

    push(
        checks,
        "gateway",
        true,
        "info",
        format!("{} gateway address(es) configured", gateways.len()),
        None,
        None,
    );

    let mut seen = HashSet::new();
    for gateway in gateways {
        let key = gateway.to_ascii_lowercase();
        if !seen.insert(key) {
            push(
                checks,
                "gateway_duplicate",
                false,
                "warn",
                format!("Duplicate gateway address `{gateway}`"),
                Some("Remove duplicate entries from gateway_addr/gateway_addrs so failover order is clear."),
                Some("gateway_duplicate"),
            );
            continue;
        }

        match parse_gateway(&gateway) {
            Ok((host, port)) => {
                let loopback = matches!(host, "localhost" | "127.0.0.1" | "::1");
                let message = if loopback {
                    format!("Gateway `{gateway}` is valid for local/dev use")
                } else {
                    format!("Gateway `{gateway}` is valid")
                };
                push(checks, "gateway_addr", true, "info", message, None, None);
                if port != 3128 {
                    push(
                        checks,
                        "gateway_port",
                        false,
                        "warn",
                        format!("Gateway `{gateway}` uses non-default port {port}"),
                        Some("Confirm the edge-gateway tunnel port. Local/dev default is 3128."),
                        Some("gateway_non_default_port"),
                    );
                }
            }
            Err(message) => push(
                checks,
                "gateway_addr",
                false,
                "error",
                message,
                Some("Use host:port, for example localhost:3128 or gw.example.com:3128."),
                Some("gateway_invalid"),
            ),
        }
    }
}

fn validate_signing_key(cfg: &Config, checks: &mut Vec<ConfigValidationCheck>) {
    let key = cfg.provider_signing_key.trim();
    if key.is_empty() {
        push(
            checks,
            "signing_key",
            false,
            "warn",
            "provider_signing_key missing; signed heartbeats are disabled",
            Some("Run provider-node keygen and add the provider_signing_key line to provider.toml, or rerun provider-node register."),
            Some("signing_key_missing"),
        );
        return;
    }

    match crate::proofs::ProviderSigner::from_base58(key) {
        Ok(signer) => push(
            checks,
            "signing_key",
            true,
            "info",
            format!("provider_signing_key valid (hotkey {})", signer.public_key()),
            None,
            None,
        ),
        Err(err) => push(
            checks,
            "signing_key",
            false,
            "error",
            format!("Invalid provider_signing_key: {err}"),
            Some("Run provider-node keygen and replace provider_signing_key with the generated value."),
            Some("signing_key_invalid"),
        ),
    }
}

fn validate_tls(cfg: &Config, checks: &mut Vec<ConfigValidationCheck>) {
    if cfg.tls_skip_verify {
        push(
            checks,
            "tls_skip_verify",
            false,
            "warn",
            "tls_skip_verify is enabled",
            Some("Use tls_skip_verify only for local/dev testing. Disable it for public gateways."),
            Some("tls_skip_verify_enabled"),
        );
    }

    let cert_path = cfg.tls_cert_path.trim();
    if !cert_path.is_empty() {
        if std::path::Path::new(cert_path).exists() {
            push(
                checks,
                "tls_cert_path",
                true,
                "info",
                format!("Custom TLS CA certificate found at {cert_path}"),
                None,
                None,
            );
        } else {
            push(
                checks,
                "tls_cert_path",
                false,
                "error",
                format!("tls_cert_path does not exist: {cert_path}"),
                Some("Fix tls_cert_path or remove it to use the system/webpki trust store."),
                Some("tls_cert_missing"),
            );
        }
    }
}

fn validate_limits(cfg: &Config, checks: &mut Vec<ConfigValidationCheck>) {
    if cfg.max_connections == 0 {
        push(
            checks,
            "max_connections",
            false,
            "error",
            "max_connections must be greater than 0",
            Some("Set max_connections to a positive value, for example 100 or 500."),
            Some("max_connections_invalid"),
        );
    } else {
        push(
            checks,
            "max_connections",
            true,
            "info",
            format!("max_connections = {}", cfg.max_connections),
            None,
            None,
        );
    }

    if cfg.bandwidth_limit_mbps == 0 {
        push(
            checks,
            "bandwidth_limit_mbps",
            false,
            "error",
            "bandwidth_limit_mbps must be greater than 0",
            Some("Set bandwidth_limit_mbps to the Mbps you are willing to share."),
            Some("bandwidth_limit_invalid"),
        );
    }

    if cfg.allowed_ports.is_empty() {
        push(
            checks,
            "allowed_ports",
            false,
            "error",
            "allowed_ports is empty; no destination ports can be proxied",
            Some("Use allowed_ports = [80, 443, 8080, 8443] unless you need a stricter policy."),
            Some("allowed_ports_empty"),
        );
    } else if cfg.allowed_ports.contains(&0) {
        push(
            checks,
            "allowed_ports",
            false,
            "error",
            "allowed_ports contains port 0",
            Some("Remove port 0. Valid TCP destination ports are 1 through 65535."),
            Some("allowed_ports_invalid"),
        );
    } else {
        push(
            checks,
            "allowed_ports",
            true,
            "info",
            format!("{} allowed destination port(s)", cfg.allowed_ports.len()),
            None,
            None,
        );
    }
}

fn validate_runtime(cfg: &Config, checks: &mut Vec<ConfigValidationCheck>) {
    if cfg.metrics_enabled {
        if cfg.metrics_port == 0 {
            push(
                checks,
                "metrics_port",
                false,
                "error",
                "metrics_port must be greater than 0 when metrics are enabled",
                Some("Use metrics_port = 9090 unless another local service already uses it."),
                Some("metrics_port_invalid"),
            );
        } else {
            push(
                checks,
                "metrics_port",
                true,
                "info",
                format!("metrics_port = {}", cfg.metrics_port),
                None,
                None,
            );
        }
    } else {
        push(
            checks,
            "metrics_enabled",
            false,
            "warn",
            "metrics_enabled is false; local status/dashboard will be less useful",
            Some("Set metrics_enabled = true for easier troubleshooting."),
            Some("metrics_disabled"),
        );
    }

    validate_duration(
        checks,
        "reconnect_interval",
        cfg.reconnect_interval,
        Duration::from_secs(30),
    );
    validate_duration(
        checks,
        "connect_timeout",
        cfg.connect_timeout,
        Duration::from_secs(10),
    );

    if cfg.connection_type.trim().is_empty() {
        push(
            checks,
            "connection_type",
            false,
            "error",
            "connection_type is empty",
            Some("Set connection_type = \"residential\" unless this node is explicitly data-center or mobile."),
            Some("connection_type_missing"),
        );
    }

    if !(1..=16).contains(&cfg.yamux_conns_per_node) {
        push(
            checks,
            "yamux_conns_per_node",
            false,
            "error",
            format!(
                "yamux_conns_per_node must be between 1 and 16, got {}",
                cfg.yamux_conns_per_node
            ),
            Some("Set yamux_conns_per_node = 1 unless gateway capacity testing says otherwise."),
            Some("yamux_lanes_invalid"),
        );
    }
}

fn validate_transport_env(cfg: &Config, checks: &mut Vec<ConfigValidationCheck>) {
    if let Ok(raw) = std::env::var("YAMUX_CONNS_PER_NODE") {
        match raw.trim().parse::<usize>() {
            Ok(n) if (1..=16).contains(&n) => push(
                checks,
                "yamux_conns_per_node_env",
                true,
                "info",
                format!("YAMUX_CONNS_PER_NODE overrides config with {n}"),
                None,
                None,
            ),
            Ok(n) => push(
                checks,
                "yamux_conns_per_node_env",
                false,
                "warn",
                format!("YAMUX_CONNS_PER_NODE={n} will be clamped to 1..16"),
                Some(
                    "Set YAMUX_CONNS_PER_NODE between 1 and 16, or unset it to use provider.toml.",
                ),
                Some("yamux_env_clamped"),
            ),
            Err(_) => push(
                checks,
                "yamux_conns_per_node_env",
                false,
                "warn",
                format!("YAMUX_CONNS_PER_NODE={raw} is not a number and will be ignored"),
                Some(
                    "Set YAMUX_CONNS_PER_NODE between 1 and 16, or unset it to use provider.toml.",
                ),
                Some("yamux_env_invalid"),
            ),
        }
    }

    match ProviderTransport::from_env() {
        ProviderTransport::Quic => {
            #[cfg(not(feature = "quic"))]
            push(
                checks,
                "provider_transport",
                false,
                "error",
                "PROVIDER_TRANSPORT=quic but this binary was built without the quic feature",
                Some("Rebuild provider-node with --features quic, use the packaged QUIC build, or unset PROVIDER_TRANSPORT."),
                Some("quic_feature_missing"),
            );
            #[cfg(feature = "quic")]
            push(
                checks,
                "provider_transport",
                true,
                "info",
                "PROVIDER_TRANSPORT=quic is available in this binary",
                None,
                None,
            );
            if !cfg.use_tls {
                push(
                    checks,
                    "provider_transport_tls",
                    false,
                    "warn",
                    "PROVIDER_TRANSPORT=quic requires TLS; start will enable TLS automatically",
                    Some("Set use_tls = true in provider.toml so validation matches runtime behavior."),
                    Some("quic_tls_config"),
                );
            }
        }
        ProviderTransport::Yamux => push(
            checks,
            "provider_transport",
            true,
            "info",
            "PROVIDER_TRANSPORT=yamux",
            None,
            None,
        ),
    }
}

fn validate_duration(
    checks: &mut Vec<ConfigValidationCheck>,
    id: &str,
    value: Duration,
    _suggested: Duration,
) {
    if value.as_secs() == 0 {
        let remediation = match id {
            "reconnect_interval" => "Set reconnect_interval = 30.",
            "connect_timeout" => "Set connect_timeout = 10.",
            _ => "Set the duration to a positive number of seconds.",
        };
        let remediation_code = match id {
            "reconnect_interval" => "reconnect_interval_invalid",
            "connect_timeout" => "connect_timeout_invalid",
            _ => "duration_invalid",
        };
        push(
            checks,
            id,
            false,
            "error",
            format!("{id} must be greater than 0 seconds"),
            Some(remediation),
            Some(remediation_code),
        );
    }
}

fn gateway_list(cfg: &Config) -> Vec<String> {
    let mut gateways = Vec::new();
    let primary = cfg.gateway_addr.trim();
    if !primary.is_empty() {
        gateways.push(primary.to_string());
    }
    for addr in &cfg.gateway_addrs {
        let addr = addr.trim();
        if !addr.is_empty() {
            gateways.push(addr.to_string());
        }
    }
    gateways
}

fn parse_gateway(addr: &str) -> Result<(&str, u16), String> {
    let trimmed = addr.trim();
    if trimmed.is_empty() {
        return Err("Gateway address is empty".to_string());
    }

    if let Some(rest) = trimmed.strip_prefix('[') {
        let Some((host, port_part)) = rest.split_once("]:") else {
            return Err(format!("Gateway `{addr}` must use [ipv6]:port syntax"));
        };
        let port = parse_port(addr, port_part)?;
        return Ok((host, port));
    }

    let Some((host, port_part)) = trimmed.rsplit_once(':') else {
        return Err(format!("Gateway `{addr}` is missing a port"));
    };
    if host.trim().is_empty() {
        return Err(format!("Gateway `{addr}` has an empty host"));
    }
    let port = parse_port(addr, port_part)?;
    Ok((host, port))
}

fn parse_port(addr: &str, port_part: &str) -> Result<u16, String> {
    match port_part.parse::<u16>() {
        Ok(0) => Err(format!("Gateway `{addr}` has invalid port 0")),
        Ok(port) => Ok(port),
        Err(_) => Err(format!("Gateway `{addr}` has an invalid port")),
    }
}

fn push(
    checks: &mut Vec<ConfigValidationCheck>,
    id: &str,
    ok: bool,
    severity: &str,
    message: impl Into<String>,
    remediation: Option<&str>,
    remediation_code: Option<&str>,
) {
    checks.push(ConfigValidationCheck {
        id: id.to_string(),
        ok,
        severity: severity.to_string(),
        message: message.into(),
        remediation: remediation.map(str::to_string),
        remediation_code: remediation_code.map(str::to_string),
    });
}

fn finish(config_path: String, checks: Vec<ConfigValidationCheck>) -> ConfigValidationReport {
    let ok = !checks.iter().any(|c| !c.ok && c.severity == "error");
    ConfigValidationReport {
        config_path,
        checks,
        ok,
    }
}

pub fn print_human(report: &ConfigValidationReport) {
    println!("--- Provider Node Config Validate ---");
    println!("Config: {}", report.config_path);
    println!();
    for check in &report.checks {
        let mark = if check.ok {
            "OK"
        } else if check.severity == "warn" {
            "WARN"
        } else {
            "FAIL"
        };
        println!("[{mark}] {} - {}", check.id, check.message);
        if let Some(remediation) = &check.remediation {
            println!("      Fix: {remediation}");
        }
    }
    println!();
    if report.ok {
        println!("Result: config is valid for startup");
    } else {
        println!("Result: fix FAIL items before running provider-node start");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_config_path(name: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "proxyhubb-provider-node-{name}-{}.toml",
            std::process::id()
        ));
        path
    }

    #[test]
    fn validates_missing_config_as_error() {
        let path = temp_config_path("missing");
        let _ = std::fs::remove_file(&path);
        let report = run(path);
        assert!(!report.ok);
        assert!(report
            .checks
            .iter()
            .any(|c| c.id == "config_file" && c.severity == "error"));
    }

    #[test]
    fn validates_generated_default_config() {
        let path = temp_config_path("valid");
        let generated = crate::proofs::ProviderSigner::generate().unwrap();
        let mut cfg = Config::default();
        cfg.api_key = "provider-token".to_string();
        cfg.provider_signing_key = generated.secret_base58;
        cfg.save(&path).unwrap();

        let report = run(path.clone());
        let _ = std::fs::remove_file(path);

        assert!(report.ok, "{report:#?}");
        assert!(report.checks.iter().any(|c| c.id == "signing_key" && c.ok));
    }

    #[test]
    fn invalid_signing_key_blocks_startup() {
        let path = temp_config_path("bad-key");
        let mut cfg = Config::default();
        cfg.api_key = "provider-token".to_string();
        cfg.provider_signing_key = "not-base58-or-valid-length".to_string();
        cfg.save(&path).unwrap();

        let report = run(path.clone());
        let _ = std::fs::remove_file(path);

        assert!(!report.ok);
        assert!(report
            .checks
            .iter()
            .any(|c| c.id == "signing_key" && c.severity == "error"));
    }
}

use crate::config::{Config, ProviderTransport};
use crate::ip;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;
use tokio::net::{TcpStream, UdpSocket};
use tokio::time::timeout;
use tokio_rustls::TlsConnector;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DoctorReport {
    pub config_path: String,
    pub checks: Vec<Check>,
    pub ok: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Check {
    pub id: String,
    pub ok: bool,
    pub severity: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remediation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remediation_code: Option<String>,
}

pub async fn run(config_path: PathBuf) -> Result<DoctorReport> {
    let path_str = config_path.to_string_lossy().into_owned();
    let mut checks = Vec::new();

    let cfg = if config_path.exists() {
        push(
            &mut checks,
            "config_file",
            true,
            "info",
            format!("Found {}", path_str),
        );
        match Config::load(&path_str) {
            Ok(c) => {
                push(
                    &mut checks,
                    "config_parse",
                    true,
                    "info",
                    "Configuration parses",
                );
                c
            }
            Err(e) => {
                push_fix(
                    &mut checks,
                    "config_parse",
                    false,
                    "error",
                    format!("Invalid TOML: {e}"),
                    "Fix the TOML syntax near the reported line, or regenerate provider.toml from the dashboard.",
                    "config_parse_failed",
                );
                return Ok(finish(path_str, checks));
            }
        }
    } else {
        push_fix(
            &mut checks,
            "config_file",
            false,
            "error",
            format!("Missing config at {path_str}"),
            "Run provider-node register --api-key <PROVIDER_TOKEN> --config provider.toml, or download a provider.toml from the dashboard.",
            "config_missing",
        );
        return Ok(finish(path_str, checks));
    };

    if cfg.api_key.trim().is_empty() && cfg.jwt_token.trim().is_empty() {
        push_fix(
            &mut checks,
            "credentials",
            false,
            "error",
            "Set api_key or jwt_token in config (dashboard → API tokens)",
            "Create a provider API token in the dashboard, then set api_key = \"<token>\" in provider.toml.",
            "credentials_missing",
        );
    } else {
        push(
            &mut checks,
            "credentials",
            true,
            "info",
            "API key or JWT present",
        );
    }

    let api_url = cfg.control_api_url.trim();
    if api_url.is_empty() {
        push_fix(
            &mut checks,
            "control_api_url",
            false,
            "error",
            "control_api_url is empty",
            "Set control_api_url to your ProxyHubb API URL, for example http://localhost:18080 for local dev.",
            "control_api_url_missing",
        );
    } else {
        let health_url = format!("{}/health", api_url.trim_end_matches('/'));
        match reqwest::get(&health_url).await {
            Ok(resp) if resp.status().is_success() => {
                push(
                    &mut checks,
                    "control_api_health",
                    true,
                    "info",
                    format!("Control API reachable ({health_url})"),
                );
            }
            Ok(resp) => {
                push_fix(
                    &mut checks,
                    "control_api_health",
                    false,
                    "error",
                    format!("Control API health HTTP {}", resp.status()),
                    "Confirm control_api_url points to the running Control API and that /health returns success.",
                    "control_api_unhealthy",
                );
            }
            Err(e) => {
                push_fix(
                    &mut checks,
                    "control_api_health",
                    false,
                    "error",
                    format!("Cannot reach Control API: {e}"),
                    "Start the Docker stack or update control_api_url to the reachable API endpoint.",
                    "control_api_unreachable",
                );
            }
        }

        if !cfg.api_key.trim().is_empty() {
            match ip::validate_api_key(api_url, cfg.api_key.trim()).await {
                Ok((user_id, _)) => {
                    push(
                        &mut checks,
                        "provider_auth",
                        true,
                        "info",
                        format!(
                            "Provider api_key valid (user {user_id}); runtime uses POST /v1/provider/gateway-token (~1h JWT, auto-refreshed)"
                        ),
                    );
                }
                Err(e) => {
                    push_fix(
                        &mut checks,
                        "provider_auth",
                        false,
                        "error",
                        format!("Provider auth failed: {e}"),
                        "Create a fresh provider API token and update api_key in provider.toml. Install a downloaded dashboard config with: provider-node config install --from <path>, or use Connect → Setup this PC.",
                        "provider_auth_failed",
                    );
                }
            }
            push(
                &mut checks,
                "auth_model",
                true,
                "info",
                "Auth model: api_key (long-lived) → /v1/provider/gateway-token (short JWT for tunnel + Control API). Leave jwt_token empty.",
            );
        } else if !cfg.jwt_token.trim().is_empty() {
            push_fix(
                &mut checks,
                "provider_auth",
                true,
                "warn",
                "Using static jwt_token only; it cannot be refreshed and typically expires in ~1 hour",
                "Prefer api_key from dashboard → API tokens. join/register leave jwt_token empty on purpose.",
                "jwt_token_only",
            );
            push(
                &mut checks,
                "auth_model",
                true,
                "warn",
                "Auth model: jwt_token is for legacy/debug. Production nodes should use api_key + gateway-token refresh.",
            );
        }
    }

    let gateways: Vec<&str> = if !cfg.gateway_addr.is_empty() {
        std::iter::once(cfg.gateway_addr.as_str())
            .chain(cfg.gateway_addrs.iter().map(String::as_str))
            .collect()
    } else {
        cfg.gateway_addrs.iter().map(String::as_str).collect()
    };
    if gateways.is_empty() {
        push_fix(
            &mut checks,
            "gateway",
            false,
            "error",
            "No gateway_addr configured",
            "Set gateway_addr = \"<host>:3128\" or gateway_addrs = [\"<host>:3128\"].",
            "gateway_missing",
        );
    } else {
        push(
            &mut checks,
            "gateway",
            true,
            "info",
            format!("Gateway(s): {}", gateways.join(", ")),
        );
    }

    let transport = ProviderTransport::from_env();
    match transport {
        ProviderTransport::Quic => {
            #[cfg(not(feature = "quic"))]
            push_fix(
                &mut checks,
                "provider_transport",
                false,
                "error",
                "PROVIDER_TRANSPORT=quic but this binary was built without the quic feature. \
                 Rebuild with --features quic or use proxyhubb-cli.ps1 (dev cargo enables quic).",
                "Rebuild provider-node with --features quic, use the packaged QUIC build, or unset PROVIDER_TRANSPORT.",
                "quic_feature_missing",
            );
            #[cfg(feature = "quic")]
            push(
                &mut checks,
                "provider_transport",
                true,
                "info",
                "PROVIDER_TRANSPORT=quic (UDP+TLS to gateway; matches docker-compose.provider.yml)",
            );
            if !cfg.use_tls {
                push_fix(
                    &mut checks,
                    "provider_transport",
                    false,
                    "warn",
                    "PROVIDER_TRANSPORT=quic requires use_tls=true (or --use-tls)",
                    "Set use_tls = true in provider.toml so validation matches runtime behavior.",
                    "quic_tls_config",
                );
            }
        }
        ProviderTransport::Yamux => {
            push(
                &mut checks,
                "provider_transport",
                true,
                "info",
                "PROVIDER_TRANSPORT=yamux (TCP tunnel). If gateway uses QUIC (docker-compose.provider.yml), \
                 set PROVIDER_TRANSPORT=quic and build with --features quic.",
            );
            if !cfg.use_tls && crate::config::gateway_looks_public(&cfg.gateway_addr) {
                push_fix(
                    &mut checks,
                    "provider_transport",
                    false,
                    "warn",
                    "Production gateways require TLS but use_tls=false",
                    "Set use_tls = true in provider.toml (or pass --use-tls) before starting against a public gateway.",
                    "tls_required_public_gateway",
                );
            }
        }
    }

    check_gateways(&cfg, transport, &mut checks).await;

    if cfg.provider_signing_key.trim().is_empty() {
        push_fix(
            &mut checks,
            "signing_key",
            false,
            "warn",
            "provider_signing_key missing — heartbeats may fail in enforce mode",
            "Run provider-node keygen and add provider_signing_key to provider.toml, or rerun provider-node register.",
            "signing_key_missing",
        );
    } else {
        match crate::proofs::ProviderSigner::from_base58(cfg.provider_signing_key.trim()) {
            Ok(s) => {
                push(
                    &mut checks,
                    "signing_key",
                    true,
                    "info",
                    format!("Signing key loaded (hotkey {})", s.public_key()),
                );
            }
            Err(e) => {
                push_fix(
                    &mut checks,
                    "signing_key",
                    false,
                    "error",
                    format!("Invalid provider_signing_key: {e}"),
                    "Run provider-node keygen and replace provider_signing_key with the generated value.",
                    "signing_key_invalid",
                );
            }
        }
    }

    let pid_path = crate::paths::pid_file();
    let mut daemon_provider_alive = false;
    match std::fs::read_to_string(&pid_path) {
        Ok(s) => {
            let pid: u32 = s.trim().parse().unwrap_or(0);
            match crate::process_util::classify_pid(pid) {
                crate::process_util::PidLiveness::ProviderAlive => {
                    daemon_provider_alive = true;
                    push(
                        &mut checks,
                        "daemon",
                        true,
                        "info",
                        format!("Provider node running (PID {pid})"),
                    );
                }
                crate::process_util::PidLiveness::ForeignAlive => {
                    push_fix(
                        &mut checks,
                        "daemon",
                        false,
                        "warn",
                        format!(
                            "PID file points to unrelated process {pid} (PID reuse) — remove {}",
                            pid_path.display()
                        ),
                        "Run provider-node stop, delete the stale PID file, then provider-node start.",
                        "daemon_pid_reused",
                    );
                }
                crate::process_util::PidLiveness::Dead if pid > 0 => {
                    push_fix(
                        &mut checks,
                        "daemon",
                        false,
                        "warn",
                        format!(
                            "Stale PID file (process {pid} not running) — remove {} or stop the old node",
                            pid_path.display()
                        ),
                        "Run provider-node stop, or remove the stale PID file if the process is already gone.",
                        "daemon_stale_pid",
                    );
                }
                _ => {
                    push_fix(
                        &mut checks,
                        "daemon",
                        false,
                        "warn",
                        format!("Stale PID file at {}", pid_path.display()),
                        "Run provider-node stop, or remove the stale PID file if the process is already gone.",
                        "daemon_stale_pid",
                    );
                }
            }
        }
        Err(_) => {
            push_fix(
                &mut checks,
                "daemon",
                false,
                "warn",
                "Node not running (no PID file)",
                "Run provider-node start --config provider.toml after config validation passes.",
                "daemon_not_running",
            );
        }
    }

    let metrics_url = format!("http://127.0.0.1:{}/stats", cfg.metrics_port);
    if !cfg.metrics_enabled {
        push(
            &mut checks,
            "metrics",
            true,
            "info",
            "metrics_enabled=false (local /stats probe skipped)",
        );
    } else {
        match reqwest::get(&metrics_url).await {
            Ok(resp) if resp.status().is_success() => {
                push(
                    &mut checks,
                    "metrics",
                    true,
                    "info",
                    format!("Local metrics at {metrics_url}"),
                );
            }
            Ok(resp) => {
                let severity = if daemon_provider_alive {
                    "error"
                } else {
                    "warn"
                };
                push_fix(
                    &mut checks,
                    "metrics",
                    false,
                    severity,
                    format!("Metrics HTTP {}", resp.status()),
                    "Restart provider-node and confirm metrics_port is not blocked by another local service.",
                    "metrics_unhealthy",
                );
            }
            Err(_) => {
                let (severity, hint) = if daemon_provider_alive {
                    (
                        "error",
                        "Daemon PID is alive but /stats is down — check metrics_port bind failure or firewall.",
                    )
                } else {
                    (
                        "warn",
                        "Start provider-node, or check metrics_enabled and metrics_port in provider.toml.",
                    )
                };
                push_fix(
                    &mut checks,
                    "metrics",
                    false,
                    severity,
                    format!("Metrics not reachable at {metrics_url}"),
                    hint,
                    "metrics_unreachable",
                );
            }
        }
    }

    Ok(finish(path_str, checks))
}

async fn check_gateways(cfg: &Config, transport: ProviderTransport, checks: &mut Vec<Check>) {
    let gateways = configured_gateways(cfg);
    if gateways.is_empty() {
        return;
    }

    let timeout_duration = bounded_timeout(cfg.connect_timeout);
    for (index, gateway) in gateways.iter().enumerate() {
        let label = format!("gateway[{}]", index + 1);
        let parsed = match parse_gateway(gateway) {
            Ok(parsed) => {
                push(
                    checks,
                    "gateway_config",
                    true,
                    "info",
                    format!("{label} configured as {}:{}", parsed.host, parsed.port),
                );
                parsed
            }
            Err(err) => {
                push_fix(
                    checks,
                    "gateway_config",
                    false,
                    "error",
                    format!("{label} `{gateway}` is invalid: {err}"),
                    "Use host:port syntax, for example localhost:3128 or gw.example.com:3128.",
                    "gateway_invalid",
                );
                continue;
            }
        };

        let resolved = match resolve_gateway(&parsed, timeout_duration).await {
            Ok(addrs) => {
                push(
                    checks,
                    "gateway_dns",
                    true,
                    "info",
                    format!("{label} resolved to {}", format_addrs(&addrs)),
                );
                addrs
            }
            Err(err) => {
                push_fix(
                    checks,
                    "gateway_dns",
                    false,
                    "error",
                    format!("{label} DNS resolution failed for `{gateway}`: {err}"),
                    "Check the gateway hostname, DNS, VPN/firewall state, or use a reachable gateway_addr from the dashboard.",
                    "gateway_dns_failed",
                );
                continue;
            }
        };

        match transport {
            ProviderTransport::Yamux => {
                check_tcp_gateway(
                    checks,
                    &label,
                    gateway,
                    &parsed,
                    &resolved,
                    cfg.use_tls,
                    cfg.tls_skip_verify,
                    timeout_duration,
                )
                .await;
            }
            ProviderTransport::Quic => {
                check_quic_gateway(checks, &label, gateway, &resolved, cfg.use_tls).await;
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn check_tcp_gateway(
    checks: &mut Vec<Check>,
    label: &str,
    gateway: &str,
    parsed: &ParsedGateway,
    addrs: &[SocketAddr],
    use_tls: bool,
    tls_skip_verify: bool,
    timeout_duration: Duration,
) {
    let Ok(stream) = connect_tcp(addrs, timeout_duration).await else {
        push_fix(
            checks,
            "gateway_reachability",
            false,
            "error",
            format!("{label} TCP port is not reachable at `{gateway}`"),
            "Confirm the edge-gateway is running, the tunnel port is exposed, and local firewall/VPS security groups allow the port.",
            "gateway_tcp_unreachable",
        );
        return;
    };

    push(
        checks,
        "gateway_reachability",
        true,
        "info",
        format!("{label} TCP port reachable at `{gateway}`"),
    );

    if use_tls {
        match check_tls_handshake(stream, parsed, tls_skip_verify, timeout_duration).await {
            Ok(()) => push(
                checks,
                "gateway_tls",
                true,
                "info",
                format!("{label} TLS handshake succeeded"),
            ),
            Err(err) => push_fix(
                checks,
                "gateway_tls",
                false,
                "error",
                format!("{label} TLS handshake failed: {err}"),
                "If the gateway is plain yamux/TCP, set use_tls=false. If it is TLS, check hostname/certificate trust or tls_cert_path.",
                "gateway_tls_failed",
            ),
        }
    } else {
        push(
            checks,
            "gateway_transport",
            true,
            "info",
            format!("{label} configured for plain TCP/yamux"),
        );
    }
}

async fn check_quic_gateway(
    checks: &mut Vec<Check>,
    label: &str,
    gateway: &str,
    addrs: &[SocketAddr],
    use_tls: bool,
) {
    if !use_tls {
        push_fix(
            checks,
            "gateway_transport",
            false,
            "warn",
            format!("{label} QUIC requires TLS but use_tls=false"),
            "Set use_tls=true in provider.toml when PROVIDER_TRANSPORT=quic.",
            "quic_tls_config",
        );
    }

    let Some(addr) = addrs.first() else {
        return;
    };
    match UdpSocket::bind(if addr.is_ipv4() { "0.0.0.0:0" } else { "[::]:0" }).await {
        Ok(socket) => match socket.connect(addr).await {
            Ok(()) => push(
                checks,
                "gateway_reachability",
                true,
                "info",
                format!("{label} UDP socket can target `{gateway}` ({addr})"),
            ),
            Err(err) => push_fix(
                checks,
                "gateway_reachability",
                false,
                "error",
                format!("{label} UDP connect failed for `{gateway}`: {err}"),
                "Confirm UDP tunnel traffic is allowed to the gateway port and the local network does not block UDP.",
                "gateway_udp_unreachable",
            ),
        },
        Err(err) => push_fix(
            checks,
            "gateway_reachability",
            false,
            "error",
            format!("{label} could not open a local UDP socket: {err}"),
            "Check local firewall or OS socket permissions, then retry doctor.",
            "gateway_udp_socket_failed",
        ),
    }
}

async fn resolve_gateway(
    gateway: &ParsedGateway,
    timeout_duration: Duration,
) -> Result<Vec<SocketAddr>, String> {
    let lookup = format!("{}:{}", gateway.host, gateway.port);
    let addrs = timeout(timeout_duration, tokio::net::lookup_host(&lookup))
        .await
        .map_err(|_| format!("timed out after {}s", timeout_duration.as_secs()))?
        .map_err(|err| err.to_string())?;
    let addrs: Vec<SocketAddr> = addrs.collect();
    if addrs.is_empty() {
        return Err("no addresses returned".to_string());
    }
    Ok(addrs)
}

async fn connect_tcp(
    addrs: &[SocketAddr],
    timeout_duration: Duration,
) -> std::io::Result<TcpStream> {
    let mut last_err = None;
    for addr in addrs {
        match timeout(timeout_duration, TcpStream::connect(addr)).await {
            Ok(Ok(stream)) => return Ok(stream),
            Ok(Err(err)) => last_err = Some(err),
            Err(_) => {
                last_err = Some(std::io::Error::new(
                    std::io::ErrorKind::TimedOut,
                    format!("timed out after {}s", timeout_duration.as_secs()),
                ));
            }
        }
    }
    Err(last_err.unwrap_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::AddrNotAvailable, "no gateway addresses")
    }))
}

async fn check_tls_handshake(
    stream: TcpStream,
    gateway: &ParsedGateway,
    tls_skip_verify: bool,
    timeout_duration: Duration,
) -> Result<(), String> {
    let cfg = Config {
        tls_skip_verify,
        ..Config::default()
    };
    let connector = TlsConnector::from(
        crate::tunnel::client::build_rustls_client_config(&cfg).map_err(|err| err.to_string())?,
    );
    let server_name = rustls::pki_types::ServerName::try_from(gateway.host.clone())
        .map_err(|_| "invalid TLS server name".to_string())?;
    timeout(timeout_duration, connector.connect(server_name, stream))
        .await
        .map_err(|_| format!("timed out after {}s", timeout_duration.as_secs()))?
        .map(|_| ())
        .map_err(|err| err.to_string())
}

fn configured_gateways(cfg: &Config) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut gateways = Vec::new();
    let mut push_gateway = |raw: &str| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return;
        }
        let dedupe_key = trimmed.to_ascii_lowercase();
        if seen.insert(dedupe_key) {
            gateways.push(trimmed.to_string());
        }
    };
    push_gateway(&cfg.gateway_addr);
    for gateway in &cfg.gateway_addrs {
        push_gateway(gateway);
    }
    gateways
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedGateway {
    host: String,
    port: u16,
}

fn parse_gateway(raw: &str) -> Result<ParsedGateway, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("empty gateway".to_string());
    }

    if let Ok(addr) = trimmed.parse::<SocketAddr>() {
        return Ok(ParsedGateway {
            host: addr.ip().to_string(),
            port: addr.port(),
        });
    }

    if let Some(rest) = trimmed.strip_prefix('[') {
        let Some((host, port_part)) = rest.split_once("]:") else {
            return Err("IPv6 gateways must use [addr]:port syntax".to_string());
        };
        return parse_gateway_host_port(host, port_part);
    }

    let Some((host, port_part)) = trimmed.rsplit_once(':') else {
        return Err("missing port".to_string());
    };
    if host.contains(':') {
        return Err("IPv6 gateways must use [addr]:port syntax".to_string());
    }
    parse_gateway_host_port(host, port_part)
}

fn parse_gateway_host_port(host: &str, port_part: &str) -> Result<ParsedGateway, String> {
    let host = host.trim().trim_end_matches('.');
    if host.is_empty() {
        return Err("empty host".to_string());
    }
    let port = port_part
        .parse::<u16>()
        .map_err(|_| "invalid port".to_string())?;
    if port == 0 {
        return Err("port must be greater than zero".to_string());
    }
    Ok(ParsedGateway {
        host: host.to_string(),
        port,
    })
}

fn format_addrs(addrs: &[SocketAddr]) -> String {
    addrs
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join(", ")
}

fn bounded_timeout(value: Duration) -> Duration {
    match value.as_secs() {
        0 => Duration::from_secs(5),
        1..=15 => value,
        _ => Duration::from_secs(15),
    }
}

fn push(checks: &mut Vec<Check>, id: &str, ok: bool, severity: &str, message: impl Into<String>) {
    checks.push(Check {
        id: id.to_string(),
        ok,
        severity: severity.to_string(),
        message: message.into(),
        remediation: None,
        remediation_code: None,
    });
}

fn push_fix(
    checks: &mut Vec<Check>,
    id: &str,
    ok: bool,
    severity: &str,
    message: impl Into<String>,
    remediation: &str,
    remediation_code: &str,
) {
    checks.push(Check {
        id: id.to_string(),
        ok,
        severity: severity.to_string(),
        message: message.into(),
        remediation: Some(remediation.to_string()),
        remediation_code: Some(remediation_code.to_string()),
    });
}

fn finish(config_path: String, checks: Vec<Check>) -> DoctorReport {
    let ok = !checks.iter().any(|c| !c.ok && c.severity == "error");
    DoctorReport {
        config_path,
        checks,
        ok,
    }
}

pub fn print_human(report: &DoctorReport) {
    println!("--- Provider Node Doctor ---");
    println!("Config: {}", report.config_path);
    println!();
    for c in &report.checks {
        let mark = if c.ok {
            "OK"
        } else if c.severity == "warn" {
            "WARN"
        } else {
            "FAIL"
        };
        println!("[{mark}] {} — {}", c.id, c.message);
        if let Some(remediation) = &c.remediation {
            println!("      Fix: {remediation}");
        }
    }
    println!();
    if report.ok {
        println!("Result: ready to start (no blocking issues)");
    } else {
        println!("Result: fix FAIL items before running in production");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_gateway_targets() {
        assert_eq!(
            parse_gateway("gateway.example.com:3128").unwrap(),
            ParsedGateway {
                host: "gateway.example.com".to_string(),
                port: 3128,
            }
        );
        assert_eq!(
            parse_gateway("[::1]:3128").unwrap(),
            ParsedGateway {
                host: "::1".to_string(),
                port: 3128,
            }
        );
        assert!(parse_gateway("gateway.example.com").is_err());
        assert!(parse_gateway("::1:3128").is_err());
        assert!(parse_gateway("gateway.example.com:0").is_err());
    }

    #[test]
    fn configured_gateways_dedupes_primary_and_failovers() {
        let mut cfg = Config::default();
        cfg.gateway_addr = "gw1.example.com:3128".to_string();
        cfg.gateway_addrs = vec![
            "gw1.example.com:3128".to_string(),
            "GW2.example.com:3128".to_string(),
            "gw2.example.com:3128".to_string(),
            "gw3.example.com:3128".to_string(),
        ];

        assert_eq!(
            configured_gateways(&cfg),
            vec![
                "gw1.example.com:3128".to_string(),
                "GW2.example.com:3128".to_string(),
                "gw3.example.com:3128".to_string(),
            ]
        );
    }

    #[test]
    fn bounded_timeout_caps_slow_config_values() {
        assert_eq!(
            bounded_timeout(Duration::from_secs(0)),
            Duration::from_secs(5)
        );
        assert_eq!(
            bounded_timeout(Duration::from_secs(7)),
            Duration::from_secs(7)
        );
        assert_eq!(
            bounded_timeout(Duration::from_secs(60)),
            Duration::from_secs(15)
        );
    }
}

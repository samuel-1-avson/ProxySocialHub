use crate::config::Config;
use crate::paths;
use crate::runtime_state::RuntimeState;
use crate::status::{self, StatusReport};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Aggregated view for TUI / `status --watch`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperatorSnapshot {
    pub status: StatusReport,
    pub config: ConfigSummary,
    pub earnings: Option<EarningsSummary>,
    pub runtime: Option<RuntimeState>,
    pub log_tail: Vec<String>,
    #[serde(default)]
    pub health: Option<HealthSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthSummary {
    pub state: String,
    pub score: u8,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigSummary {
    pub gateways: Vec<String>,
    pub transport: String,
    pub metrics_port: u16,
    pub signing_configured: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EarningsSummary {
    pub total_earned_sol: f64,
    pub pending_sol: f64,
    pub paid_sol: f64,
    pub last_7_days_sol: f64,
    pub last_30_days_sol: f64,
    pub total_sessions: i64,
    pub total_bandwidth_gb: f64,
}

pub async fn collect(config_path: PathBuf) -> Result<OperatorSnapshot> {
    let mut snap = collect_local(config_path.clone()).await?;
    refresh_remote(&mut snap, config_path).await?;
    Ok(snap)
}

/// Fast path: PID, local metrics, runtime, logs — no Control API or earnings.
pub async fn collect_local(config_path: PathBuf) -> Result<OperatorSnapshot> {
    let path_str = config_path.to_string_lossy().into_owned();
    let cfg = Config::load(&path_str).unwrap_or_default();

    let status = status::collect_with_mode(
        config_path.clone(),
        None,
        status::StatusCollectMode::LocalOnly,
    )
    .await?;

    Ok(OperatorSnapshot {
        status,
        config: config_summary_from(&cfg),
        earnings: None,
        runtime: RuntimeState::read(&paths::runtime_state_file()),
        log_tail: tail_log_file(&paths::log_file(), 12),
        health: None,
    })
}

/// Slow path: Control API nodes + earnings summary (merged into existing snapshot).
pub async fn refresh_remote(snap: &mut OperatorSnapshot, config_path: PathBuf) -> Result<()> {
    let path_str = config_path.to_string_lossy().into_owned();
    let cfg = Config::load(&path_str).unwrap_or_default();

    snap.status.control_api = status::fetch_control_api_status(&cfg).await;
    snap.earnings = fetch_earnings_summary(&cfg).await;
    snap.health = Some(compute_health(snap));
    Ok(())
}

fn compute_health(snap: &OperatorSnapshot) -> HealthSummary {
    let mut reasons = Vec::new();
    let mut score: i32 = 100;

    let tunnel_up = snap
        .runtime
        .as_ref()
        .map(|r| r.tunnel_connected)
        .unwrap_or(false);
    if !tunnel_up {
        score -= 50;
        reasons.push("Tunnel disconnected".to_string());
    }

    if let Some(m) = &snap.status.metrics {
        if m.last_heartbeat_ago_ms > 90_000 {
            score -= 20;
            reasons.push(format!(
                "Heartbeat stale ({}s ago)",
                m.last_heartbeat_ago_ms / 1000
            ));
        }
    } else {
        score -= 15;
        reasons.push("Local metrics unreachable".to_string());
    }

    if !snap.status.control_api.reachable {
        score -= 20;
        reasons.push("Control API unreachable".to_string());
    }

    if !snap.config.signing_configured {
        score -= 10;
        reasons.push("Heartbeat signing key missing".to_string());
    }

    let score = score.clamp(0, 100) as u8;
    let state = if score >= 80 {
        "ONLINE"
    } else if score >= 50 {
        "DEGRADED"
    } else {
        "DOWN"
    }
    .to_string();

    HealthSummary {
        state,
        score,
        reasons,
    }
}

fn config_summary_from(cfg: &Config) -> ConfigSummary {
    let mut gateways = Vec::new();
    if !cfg.gateway_addr.is_empty() {
        gateways.push(cfg.gateway_addr.clone());
    }
    for g in &cfg.gateway_addrs {
        if !gateways.contains(g) {
            gateways.push(g.clone());
        }
    }

    let transport = match crate::config::ProviderTransport::from_env() {
        crate::config::ProviderTransport::Quic => "quic".to_string(),
        crate::config::ProviderTransport::Yamux => "yamux".to_string(),
    };

    ConfigSummary {
        gateways,
        transport,
        metrics_port: cfg.metrics_port,
        signing_configured: !cfg.provider_signing_key.trim().is_empty(),
    }
}

async fn fetch_earnings_summary(cfg: &Config) -> Option<EarningsSummary> {
    let bearer = resolve_bearer(cfg).await.ok()?;
    let url = format!(
        "{}/v1/provider/earnings/summary",
        cfg.control_api_url.trim_end_matches('/')
    );
    let resp = reqwest::Client::new()
        .get(&url)
        .header("Authorization", format!("Bearer {bearer}"))
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.json().await.ok()
}

async fn resolve_bearer(cfg: &Config) -> Result<String> {
    if !cfg.jwt_token.trim().is_empty() {
        return Ok(cfg.jwt_token.trim().to_string());
    }
    if !cfg.api_key.trim().is_empty() {
        let (_uid, jwt) =
            crate::ip::validate_api_key(&cfg.control_api_url, cfg.api_key.trim()).await?;
        return Ok(jwt);
    }
    anyhow::bail!("no credentials in config")
}

pub fn print_human(snap: &OperatorSnapshot) {
    status::print_human(&snap.status);
    println!();
    println!("--- Tunnel / config ---");
    println!("Transport: {}", snap.config.transport);
    if let Some(rt) = &snap.runtime {
        println!(
            "Tunnel: {} · gateway {} ({}/{}) · transport {}",
            if rt.tunnel_connected {
                "connected"
            } else {
                "down"
            },
            rt.active_gateway,
            rt.gateway_index + 1,
            rt.gateway_total,
            rt.transport
        );
        if let Some(e) = &rt.last_session_error {
            println!("Last session error: {e}");
        }
    } else if !snap.config.gateways.is_empty() {
        println!("Configured gateways: {}", snap.config.gateways.join(", "));
    }
    if let Some(e) = &snap.earnings {
        println!();
        println!("--- Earnings ---");
        println!(
            "Total: {:.4} SOL (pending {:.4}, paid {:.4})",
            e.total_earned_sol, e.pending_sol, e.paid_sol
        );
        println!(
            "7d: {:.4} · 30d: {:.4} SOL",
            e.last_7_days_sol, e.last_30_days_sol
        );
    }
    if !snap.log_tail.is_empty() {
        println!();
        println!("--- Recent log ---");
        for line in &snap.log_tail {
            println!("  {line}");
        }
    }
}

pub fn tail_log_file(path: &Path, max_lines: usize) -> Vec<String> {
    let body = match std::fs::read_to_string(path) {
        Ok(b) => b,
        Err(_) => return Vec::new(),
    };
    let lines: Vec<&str> = body.lines().collect();
    if lines.len() <= max_lines {
        return lines.into_iter().map(String::from).collect();
    }
    lines[lines.len() - max_lines..]
        .iter()
        .map(|s| (*s).to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Config;
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_path(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("proxyhubb-optest-{nanos}-{name}"))
    }

    #[test]
    fn config_summary_dedupes_gateways_and_flags_signing() {
        let mut cfg = Config::default();
        cfg.gateway_addr = "gw1:3128".into();
        cfg.gateway_addrs = vec!["gw1:3128".into(), "gw2:3128".into()];
        cfg.metrics_port = 9091;
        cfg.provider_signing_key = "ed25519:test".into();

        let summary = config_summary_from(&cfg);
        assert_eq!(summary.gateways, vec!["gw1:3128", "gw2:3128"]);
        assert_eq!(summary.metrics_port, 9091);
        assert!(summary.signing_configured);
        assert!(!summary.transport.is_empty());
    }

    #[test]
    fn tail_log_file_returns_last_n_lines() {
        let path = unique_temp_path("provider.log");
        let mut f = std::fs::File::create(&path).expect("create");
        writeln!(f, "one").unwrap();
        writeln!(f, "two").unwrap();
        writeln!(f, "three").unwrap();
        writeln!(f, "four").unwrap();

        let tail = tail_log_file(&path, 2);
        let _ = std::fs::remove_file(&path);
        assert_eq!(tail, vec!["three".to_string(), "four".to_string()]);
    }

    #[test]
    fn collect_local_smoke_builds_snapshot_without_remote() {
        let cfg_path = unique_temp_path("provider.toml");
        let toml = r#"
control_api_url = "http://127.0.0.1:18080"
gateway_addr = "127.0.0.1:3128"
api_key = "pk_test"
jwt_token = ""
node_id = ""
metrics_port = 9090
"#;
        std::fs::write(&cfg_path, toml).expect("write config");

        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        let snap = rt
            .block_on(collect_local(cfg_path.clone()))
            .expect("collect_local");
        let _ = std::fs::remove_file(&cfg_path);

        assert_eq!(snap.config.gateways, vec!["127.0.0.1:3128".to_string()]);
        assert!(snap.earnings.is_none());
        assert!(!snap.status.config_path.is_empty());
    }
}

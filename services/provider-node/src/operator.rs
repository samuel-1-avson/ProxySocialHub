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
    })
}

/// Slow path: Control API nodes + earnings summary (merged into existing snapshot).
pub async fn refresh_remote(snap: &mut OperatorSnapshot, config_path: PathBuf) -> Result<()> {
    let path_str = config_path.to_string_lossy().into_owned();
    let cfg = Config::load(&path_str).unwrap_or_default();

    snap.status.control_api = status::fetch_control_api_status(&cfg).await;
    snap.earnings = fetch_earnings_summary(&cfg).await;
    Ok(())
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

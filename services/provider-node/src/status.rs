use crate::config::Config;
use crate::ip;
use crate::stats;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusReport {
    pub config_path: String,
    pub process: ProcessStatus,
    pub metrics: Option<stats::Snapshot>,
    pub control_api: ControlAPIStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub pid_file: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ControlAPIStatus {
    pub url: String,
    pub reachable: bool,
    pub user_id: Option<String>,
    pub nodes: Vec<ControlNodeSummary>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ControlNodeSummary {
    pub id: String,
    pub name: String,
    pub status: String,
    pub gateway_node_id: String,
    pub ip_address: String,
    #[serde(default)]
    pub is_healthy: bool,
    #[serde(default)]
    pub latest_heartbeat_verified: bool,
    #[serde(default)]
    pub latest_heartbeat_verification_error: String,
    #[serde(default)]
    pub latest_heartbeat_signer: String,
    #[serde(default)]
    pub hotkey: String,
}

#[derive(Deserialize)]
struct MyNodesResponse {
    nodes: Vec<ControlNodeRow>,
}

#[derive(Deserialize)]
struct ControlNodeRow {
    id: String,
    name: String,
    status: String,
    #[serde(default)]
    gateway_node_id: String,
    #[serde(default)]
    ip_address: String,
    #[serde(default)]
    is_healthy: bool,
    #[serde(default)]
    latest_heartbeat_verified: bool,
    #[serde(default)]
    latest_heartbeat_verification_error: String,
    #[serde(default)]
    latest_heartbeat_signer: String,
    #[serde(default)]
    hotkey: String,
}

pub async fn collect(
    config_path: PathBuf,
    metrics_port_override: Option<u16>,
) -> Result<StatusReport> {
    collect_with_mode(config_path, metrics_port_override, StatusCollectMode::Full).await
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StatusCollectMode {
    /// Process + local `/stats` only (no Control API round-trip).
    LocalOnly,
    Full,
}

pub async fn collect_with_mode(
    config_path: PathBuf,
    metrics_port_override: Option<u16>,
    mode: StatusCollectMode,
) -> Result<StatusReport> {
    let path_str = config_path.to_string_lossy().into_owned();
    let cfg = Config::load(&path_str).unwrap_or_default();
    let pid_path = crate::paths::pid_file();
    let pid_file = pid_path.to_string_lossy().into_owned();

    let (running, pid) = match std::fs::read_to_string(&pid_path) {
        Ok(s) => {
            let p: u32 = s.trim().parse().unwrap_or(0);
            let alive = p > 0 && crate::process_util::process_alive(p);
            (alive, if alive { Some(p) } else { None })
        }
        Err(_) => (false, None),
    };

    let metrics_port = metrics_port_override.unwrap_or(cfg.metrics_port);
    let metrics_url = format!("http://127.0.0.1:{metrics_port}/stats");
    let metrics = match reqwest::get(&metrics_url).await {
        Ok(resp) if resp.status().is_success() => resp.json().await.ok(),
        _ => None,
    };

    let api_url = cfg.control_api_url.clone();
    let control = if mode == StatusCollectMode::Full {
        fetch_control_api_status(&cfg).await
    } else {
        ControlAPIStatus {
            url: api_url,
            reachable: false,
            user_id: None,
            nodes: Vec::new(),
            error: None,
        }
    };

    Ok(StatusReport {
        config_path: path_str,
        process: ProcessStatus {
            running,
            pid,
            pid_file,
        },
        metrics,
        control_api: control,
    })
}

pub async fn fetch_control_api_status(cfg: &Config) -> ControlAPIStatus {
    let api_url = cfg.control_api_url.clone();
    let mut control = ControlAPIStatus {
        url: api_url.clone(),
        reachable: false,
        user_id: None,
        nodes: Vec::new(),
        error: None,
    };

    match resolve_control_bearer(cfg).await {
        Ok((user_id, bearer)) => {
            control.user_id = Some(user_id);
            match fetch_control_nodes(&api_url, &bearer).await {
                Ok(nodes) => {
                    control.reachable = true;
                    control.nodes = nodes;
                }
                Err(e) => {
                    control.error = Some(e.to_string());
                }
            }
        }
        Err(e) => {
            control.error = Some(e.to_string());
        }
    }

    control
}

async fn resolve_control_bearer(cfg: &Config) -> Result<(String, String)> {
    if !cfg.jwt_token.trim().is_empty() {
        return Ok((String::new(), cfg.jwt_token.trim().to_string()));
    }
    if !cfg.api_key.trim().is_empty() {
        let (user_id, jwt) = ip::validate_api_key(&cfg.control_api_url, cfg.api_key.trim()).await?;
        return Ok((user_id, jwt));
    }
    anyhow::bail!("config has no api_key or jwt_token for Control API")
}

async fn fetch_control_nodes(api_url: &str, bearer: &str) -> Result<Vec<ControlNodeSummary>> {
    let url = format!("{api_url}/v1/provider/nodes");
    let resp = reqwest::Client::new()
        .get(&url)
        .header("Authorization", format!("Bearer {bearer}"))
        .send()
        .await
        .context("Control API request failed")?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!("GET /v1/provider/nodes HTTP {status}: {body}");
    }

    let body: MyNodesResponse = resp.json().await.context("parse nodes response")?;
    Ok(body
        .nodes
        .into_iter()
        .map(|n| ControlNodeSummary {
            id: n.id,
            name: n.name,
            status: n.status,
            gateway_node_id: n.gateway_node_id,
            ip_address: n.ip_address,
            is_healthy: n.is_healthy,
            latest_heartbeat_verified: n.latest_heartbeat_verified,
            latest_heartbeat_verification_error: n.latest_heartbeat_verification_error,
            latest_heartbeat_signer: n.latest_heartbeat_signer,
            hotkey: n.hotkey,
        })
        .collect())
}

pub fn print_human(report: &StatusReport) {
    println!("--- Provider Node Status ---");
    println!("Config:     {}", report.config_path);
    println!(
        "Process:    {}",
        if report.process.running {
            format!(
                "running (pid {:?}, file {})",
                report.process.pid, report.process.pid_file
            )
        } else {
            format!("not running (pid file {})", report.process.pid_file)
        }
    );

    if let Some(m) = &report.metrics {
        println!("Metrics:    reachable");
        println!("  Uptime:              {}s", m.uptime_seconds);
        println!("  Active connections:  {}", m.active_connections);
        println!("  Latency (gateway):   {} ms", m.latency_ms);
        println!("  Connection type:     {}", m.connection_type);
    } else {
        println!("Metrics:    not reachable (is the node running?)");
    }

    println!("Control API: {}", report.control_api.url);
    if report.control_api.reachable {
        if let Some(uid) = &report.control_api.user_id {
            if !uid.is_empty() {
                println!("  User:       {uid}");
            }
        }
        if report.control_api.nodes.is_empty() {
            println!("  Nodes:      (none registered)");
        } else {
            println!("  Nodes:");
            for n in &report.control_api.nodes {
                let hb = if n.latest_heartbeat_verified {
                    "proof ok".to_string()
                } else if !n.latest_heartbeat_verification_error.is_empty() {
                    format!("proof err: {}", n.latest_heartbeat_verification_error)
                } else {
                    "proof —".to_string()
                };
                println!(
                    "    - {}  {}  status={}  gw={}  ip={}  {}",
                    n.id, n.name, n.status, n.gateway_node_id, n.ip_address, hb
                );
            }
        }
    } else if let Some(err) = &report.control_api.error {
        println!("  Error:      {err}");
    }
}

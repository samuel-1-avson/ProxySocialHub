use anyhow::{Context, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tracing::debug;

/// Detect the public IP address by querying multiple external services.
pub async fn detect_public_ip() -> Option<String> {
    let services = [
        "https://api.ipify.org",
        "https://ifconfig.me/ip",
        "https://icanhazip.com",
        "https://checkip.amazonaws.com",
    ];

    let client = Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .ok()?;

    for url in services {
        match client.get(url).send().await {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(body) = resp.text().await {
                    let ip = body.trim().to_string();
                    if !ip.is_empty() {
                        debug!(service = url, ip = %ip, "Public IP detected");
                        return Some(ip);
                    }
                }
            }
            _ => continue,
        }
    }

    None
}

// ── API Key Validation ──────────────────────────────────────────────

#[derive(Deserialize)]
struct AuthResponse {
    valid: bool,
    user_id: Option<String>,
    jwt_token: Option<String>,
    message: Option<String>,
}

/// Validate an API key against the Control API and return (user_id, jwt_token).
pub async fn validate_api_key(api_url: &str, api_key: &str) -> Result<(String, String)> {
    let url = format!("{api_url}/v1/provider/auth");
    let payload = serde_json::json!({ "token": api_key });

    let resp = Client::new()
        .post(&url)
        .json(&payload)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .context("Failed to connect to Control API")?;

    let status = resp.status();
    let body: AuthResponse = resp
        .json()
        .await
        .context("Failed to parse auth response")?;

    if !status.is_success() || !body.valid {
        let msg = body.message.unwrap_or_else(|| "unknown error".into());
        anyhow::bail!("Authentication failed (HTTP {status}): {msg}");
    }

    let user_id = body.user_id.unwrap_or_default();
    let jwt = body.jwt_token.unwrap_or_default();
    Ok((user_id, jwt))
}

// ── Node Registration ───────────────────────────────────────────────

#[derive(Deserialize)]
struct RegisterResponse {
    id: Option<String>,
}

#[derive(Serialize)]
pub struct ProviderLeaseRequest {
    pub connection_type: String,
    pub available_ports: Vec<u16>,
    pub max_connections: u32,
    pub max_bandwidth_mbps: u32,
    pub uplink_speed_kbps: u32,
    pub downlink_speed_kbps: u32,
    pub cpu_cores: u32,
    pub memory_mb: u32,
    pub os: String,
    pub client_version: String,
    pub features: Vec<String>,
}

#[derive(Deserialize)]
struct ProviderLeaseResponse {
    token: String,
    expires_in: Option<u64>,
    renew_after_secs: Option<u64>,
}

#[derive(Clone, Debug)]
pub struct ProviderLeaseGrant {
    pub token: String,
    pub expires_in: u64,
    pub renew_after_secs: u64,
}

/// Register a new node with the Control API and return the node ID.
pub async fn register_node(
    api_url: &str,
    jwt: &str,
    name: &str,
    ip: &str,
    connection_type: &str,
) -> Result<String> {
    let url = format!("{api_url}/v1/provider/nodes");
    let payload = serde_json::json!({
        "name": name,
        "ip_address": ip,
        "connection_type": connection_type,
    });

    let resp = Client::new()
        .post(&url)
        .header("Authorization", format!("Bearer {jwt}"))
        .json(&payload)
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .context("Failed to register node")?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!("Registration failed (HTTP {status}): {body}");
    }

    let body: RegisterResponse = resp.json().await?;
    Ok(body.id.unwrap_or_default())
}

/// POST /v1/provider/nodes/:id/heartbeat — keeps dashboard `provider_nodes` online.
pub async fn send_provider_node_heartbeat(
    api_url: &str,
    jwt: &str,
    node_id: &str,
    latency_ms: i32,
    active_connections: i32,
    uptime_percent: f64,
) -> Result<()> {
    let node_id = node_id.trim();
    if node_id.is_empty() || !looks_like_uuid(node_id) {
        return Ok(());
    }

    let url = format!("{api_url}/v1/provider/nodes/{node_id}/heartbeat");
    let payload = serde_json::json!({
        "latency_ms": latency_ms,
        "active_connections": active_connections,
        "uptime_percent": uptime_percent,
    });

    let resp = Client::new()
        .post(&url)
        .header("Authorization", format!("Bearer {jwt}"))
        .json(&payload)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .context("Failed to send provider node heartbeat")?;

    if resp.status().is_success() {
        debug!(node_id = %node_id, "Control API provider heartbeat OK");
        return Ok(());
    }

    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    anyhow::bail!("Provider heartbeat failed (HTTP {status}): {body}");
}

fn looks_like_uuid(s: &str) -> bool {
    let s = s.trim();
    s.len() == 36 && s.chars().filter(|c| *c == '-').count() == 4
}

pub async fn fetch_provider_lease(
    api_url: &str,
    jwt: &str,
    payload: &ProviderLeaseRequest,
) -> Result<ProviderLeaseGrant> {
    let url = format!("{api_url}/v1/provider/lease");

    let resp = Client::new()
        .post(&url)
        .header("Authorization", format!("Bearer {jwt}"))
        .json(payload)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .context("Failed to request provider lease")?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!("Provider lease request failed (HTTP {status}): {body}");
    }

    let body: ProviderLeaseResponse = resp
        .json()
        .await
        .context("Failed to parse provider lease response")?;
    let expires_in = body.expires_in.unwrap_or(600);
    let renew_after_secs = body
        .renew_after_secs
        .unwrap_or_else(|| expires_in.saturating_sub(60).max(30));
    Ok(ProviderLeaseGrant {
        token: body.token,
        expires_in,
        renew_after_secs,
    })
}

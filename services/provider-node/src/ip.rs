use crate::proofs::ProviderProofEnvelope;
use anyhow::{Context, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tracing::{debug, info};

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

// ── API Key Validation / Gateway JWT ────────────────────────────────

#[derive(Deserialize)]
struct GatewayTokenResponse {
    gateway_token: String,
    user_id: String,
    /// Seconds until expiry (control-api defaults to 3600).
    #[serde(default)]
    expires_in: Option<u64>,
}

#[derive(Deserialize)]
struct GatewayTokenError {
    error: Option<String>,
}

/// Short-lived gateway access minted from a long-lived provider `api_key`.
#[derive(Clone, Debug)]
pub struct GatewayAccess {
    pub user_id: String,
    pub token: String,
    pub expires_at: std::time::Instant,
    pub expires_in: u64,
}

impl GatewayAccess {
    /// Refresh this token when less than `skew` remains before expiry.
    #[allow(dead_code)] // exercised in unit tests; runtime uses `gateway_token_needs_refresh`
    pub fn needs_refresh(&self, skew: Duration) -> bool {
        gateway_token_needs_refresh(self.expires_at, skew)
    }
}

/// True when `expires_at` is within `skew` of now (or already past).
pub fn gateway_token_needs_refresh(expires_at: std::time::Instant, skew: Duration) -> bool {
    std::time::Instant::now() + skew >= expires_at
}

/// Exchange a provider API key for a short-lived tunnel JWT (`/v1/provider/gateway-token`).
pub async fn exchange_gateway_token(api_url: &str, api_key: &str) -> Result<GatewayAccess> {
    let url = format!("{api_url}/v1/provider/gateway-token");
    let payload = serde_json::json!({ "token": api_key });

    let resp = Client::new()
        .post(&url)
        .json(&payload)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .context("Failed to connect to Control API")?;

    let status = resp.status();
    if status.is_success() {
        let body: GatewayTokenResponse = resp
            .json()
            .await
            .context("Failed to parse gateway-token response")?;
        if body.gateway_token.is_empty() || body.user_id.is_empty() {
            anyhow::bail!("gateway-token response missing user_id or gateway_token");
        }
        let expires_in = body.expires_in.unwrap_or(3600).max(60);
        return Ok(GatewayAccess {
            user_id: body.user_id,
            token: body.gateway_token,
            expires_at: std::time::Instant::now() + Duration::from_secs(expires_in),
            expires_in,
        });
    }

    let err: GatewayTokenError = resp
        .json()
        .await
        .unwrap_or(GatewayTokenError { error: None });
    let msg = err.error.unwrap_or_else(|| format!("HTTP {status}"));
    anyhow::bail!(
        "Authentication failed: {msg}. Create a fresh token in Dashboard → Provider → Connect, \
         paste the install script (writes %APPDATA%\\proxyhubb\\provider.toml on Windows), \
         or run: provider-node join --force --api-key <token> --node-id <node_id>, then restart."
    );
}

/// Validate an API key and return (user_id, tunnel JWT) for edge-gateway AUTH.
pub async fn validate_api_key(api_url: &str, api_key: &str) -> Result<(String, String)> {
    let access = exchange_gateway_token(api_url, api_key).await?;
    Ok((access.user_id, access.token))
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
#[allow(clippy::too_many_arguments)]
pub async fn send_provider_node_heartbeat(
    api_url: &str,
    jwt: &str,
    node_id: &str,
    provider_run_id: &str,
    latency_ms: i32,
    active_connections: i32,
    uptime_percent: f64,
    proof: Option<ProviderProofEnvelope>,
) -> Result<()> {
    let node_id = node_id.trim();
    if node_id.is_empty() || !looks_like_uuid(node_id) {
        return Ok(());
    }

    let url = format!("{api_url}/v1/provider/nodes/{node_id}/heartbeat");
    let mut payload = serde_json::json!({
        "latency_ms": latency_ms,
        "active_connections": active_connections,
        "uptime_percent": uptime_percent,
        "provider_run_id": provider_run_id,
    });
    if let Some(proof) = proof {
        payload["proof"] = serde_json::to_value(proof)?;
    }

    let resp = Client::new()
        .post(&url)
        .header("Authorization", format!("Bearer {jwt}"))
        .json(&payload)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .context("Failed to send provider node heartbeat")?;

    if resp.status().is_success() {
        info!(node_id = %node_id, "Control API provider heartbeat OK");
        return Ok(());
    }

    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    Err(HeartbeatApiError {
        status: status.as_u16(),
        body,
    }
    .into())
}

#[derive(Debug)]
pub struct HeartbeatApiError {
    pub status: u16,
    pub body: String,
}

impl std::fmt::Display for HeartbeatApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Provider heartbeat failed (HTTP {}): {}",
            self.status, self.body
        )
    }
}

impl std::error::Error for HeartbeatApiError {}

/// Parse suggested_node_id from a Control API heartbeat 404 body, if present.
pub fn suggested_node_id_from_heartbeat_error(err: &anyhow::Error) -> Option<String> {
    let api_err = err.downcast_ref::<HeartbeatApiError>()?;
    if api_err.status != 404 {
        return None;
    }
    let value: serde_json::Value = serde_json::from_str(&api_err.body).ok()?;
    value
        .get("suggested_node_id")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| looks_like_uuid(s))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gateway_access_needs_refresh_respects_skew() {
        let access = GatewayAccess {
            user_id: "u".into(),
            token: "t".into(),
            expires_at: std::time::Instant::now() + Duration::from_secs(120),
            expires_in: 120,
        };
        assert!(access.needs_refresh(Duration::from_secs(180)));
        assert!(!access.needs_refresh(Duration::from_secs(30)));
    }
}

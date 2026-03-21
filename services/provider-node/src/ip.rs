use anyhow::{Context, Result};
use reqwest::Client;
use serde::Deserialize;
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

/// Register a new node with the Control API and return the node ID.
pub async fn register_node(
    api_url: &str,
    jwt: &str,
    name: &str,
    ip: &str,
) -> Result<String> {
    let url = format!("{api_url}/v1/provider/nodes");
    let payload = serde_json::json!({
        "name": name,
        "ip_address": ip,
        "connection_type": "residential",
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

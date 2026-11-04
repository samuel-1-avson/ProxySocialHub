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
    anyhow::bail!(gateway_token_failure(&msg));
}

/// Did the Control API say the key itself is no good (invalid, inactive or expired)? If so,
/// reconnecting cannot succeed until the person replaces it. These are the control API's own
/// words from `issueGatewayToken`; nothing else counts, because stopping is expensive and a
/// retry is cheap.
///
/// Do NOT match on the bare word "token", on "authentication failed", or on a bare 401/403. The
/// text of a failed exchange always ends with advice containing "token" (see
/// [`gateway_token_failure`]), so any such rule makes every failure look like a refusal: a 502
/// during a deploy stopped the daemon for good. A proxy or firewall can also answer 401/403 for
/// its own reasons. The tests in `main.rs` (`fatal_auth_tests`) pin all of this.
pub fn is_key_refusal(msg: &str) -> bool {
    let m = msg.to_ascii_lowercase();
    m.contains("invalid or inactive provider token") || m.contains("provider token expired")
}

/// The error text for a failed gateway-token exchange: what the server said (or `HTTP <status>`
/// when it said nothing readable), then advice for fixing a bad key. The advice is appended to
/// EVERY failure, an outage included, so it always contains the word "token"; see
/// [`is_key_refusal`].
pub fn gateway_token_failure(server_said: &str) -> String {
    format!(
        "Authentication failed: {server_said}. Create a fresh token in Dashboard → Provider → Connect, \
         paste the install script (writes %APPDATA%\\proxyhubb\\provider.toml on Windows), \
         or run: provider-node join --force --api-key <token> --node-id <node_id>, then restart."
    )
}

/// Validate an API key and return (user_id, tunnel JWT) for edge-gateway AUTH.
/// How many times [`validate_api_key`] tries a Control API it could not reach at all.
const VALIDATE_ATTEMPTS: u32 = 3;
/// The wait before try N+1 is N times this (1 s, then 2 s); short in tests.
const VALIDATE_RETRY_STEP: Duration = if cfg!(test) {
    Duration::from_millis(20)
} else {
    Duration::from_secs(1)
};

/// Check a provider key once, for `join`, `register`, `doctor` and `status`. (The daemon calls
/// [`exchange_gateway_token`] from its own reconnect loop instead.)
///
/// A request that never reached the server is tried again after 1 s and then 2 s: home and
/// mobile routers drop a DNS query now and then, and `join` failed for good on one such miss
/// right after the installer had downloaded from the same host. If it keeps failing on DNS, the
/// error says so in plain words instead of only "dns error".
pub async fn validate_api_key(api_url: &str, api_key: &str) -> Result<(String, String)> {
    let mut attempt = 1;
    loop {
        match exchange_gateway_token(api_url, api_key).await {
            Ok(access) => return Ok((access.user_id, access.token)),
            Err(e) if attempt < VALIDATE_ATTEMPTS && never_reached_server(&e) => {
                debug!(attempt, error = %format!("{e:#}"), "Control API unreachable; trying again");
                tokio::time::sleep(VALIDATE_RETRY_STEP * attempt).await;
                attempt += 1;
            }
            Err(e) => return Err(explain_dns_failure(e, api_url)),
        }
    }
}

/// True when the request failed before reaching the server: the name did not resolve or the
/// connection was refused. Nothing was sent, so trying again is safe. A timeout is not counted:
/// a host that never answers would make `doctor` and `status` wait 10 s per try.
fn never_reached_server(err: &anyhow::Error) -> bool {
    err.chain()
        .filter_map(|e| e.downcast_ref::<reqwest::Error>())
        .any(|e| e.is_connect() && !e.is_timeout())
}

/// Put the plain reason first when the API's name could not be looked up. The words that
/// mark a refused key (see [`is_key_refusal`]) never appear here, so a DNS failure is never
/// mistaken for one.
fn explain_dns_failure(err: anyhow::Error, api_url: &str) -> anyhow::Error {
    let is_dns = never_reached_server(&err)
        && format!("{err:#}")
            .to_ascii_lowercase()
            .contains("dns error");
    if !is_dns {
        return err;
    }
    let host = reqwest::Url::parse(api_url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_string))
        .unwrap_or_else(|| api_url.to_string());
    err.context(format!(
        "Could not look up {host} (a DNS failure on this computer's network), so the key was not \
         checked. Check the internet connection, then run the same command again."
    ))
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
    total_bytes_up: u64,
    total_bytes_down: u64,
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
        "total_bytes_up": total_bytes_up,
        "total_bytes_down": total_bytes_down,
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

    /// What a person saw after `join`: "dns error / No such host is known" and nothing about
    /// what it meant. `.invalid` never resolves (RFC 6761), with or without a network.
    #[tokio::test]
    async fn a_name_that_cannot_be_looked_up_is_retried_then_explained() {
        let started = std::time::Instant::now();
        let err = validate_api_key("https://proxyhubb-dns-check.invalid", "k")
            .await
            .expect_err("an unresolvable host cannot validate a key");
        let full = format!("{err:#}");
        assert!(
            err.to_string()
                .starts_with("Could not look up proxyhubb-dns-check.invalid"),
            "{full}"
        );
        assert!(full.contains("run the same command again"), "{full}");
        // The original chain is kept for support, and the key is not blamed.
        assert!(full.contains("Failed to connect to Control API"), "{full}");
        assert!(!is_key_refusal(&full), "{full}");
        // Three tries: waits of 1 and 2 steps between them.
        assert!(started.elapsed() >= VALIDATE_RETRY_STEP * 3, "{full}");
    }

    /// A refused connection is retried too (nothing was sent), but it is not a DNS failure, so
    /// the message is left as it was.
    #[tokio::test]
    async fn a_refused_connection_is_retried_but_not_called_a_dns_failure() {
        let port = {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            listener.local_addr().unwrap().port()
        };
        let started = std::time::Instant::now();
        let err = validate_api_key(&format!("http://127.0.0.1:{port}"), "k")
            .await
            .expect_err("nothing listens on a port that was just released");
        assert!(never_reached_server(&err), "{err:#}");
        assert_eq!(err.to_string(), "Failed to connect to Control API");
        assert!(started.elapsed() >= VALIDATE_RETRY_STEP * 3, "{err:#}");
    }

    /// An answer from the server is never retried: the key was checked, and a refusal must
    /// reach the person at once.
    #[tokio::test]
    async fn a_server_that_answers_is_asked_once() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let mut served = 0u32;
            while let Ok(Ok((mut sock, _))) =
                tokio::time::timeout(Duration::from_millis(500), listener.accept()).await
            {
                let mut buf = [0u8; 4096];
                let _ = sock.read(&mut buf).await;
                let body = r#"{"error":"Invalid or inactive provider token"}"#;
                let reply = format!(
                    "HTTP/1.1 401 Unauthorized\r\ncontent-type: application/json\r\n\
                     content-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = sock.write_all(reply.as_bytes()).await;
                served += 1;
            }
            served
        });
        let err = validate_api_key(&format!("http://{addr}"), "k")
            .await
            .expect_err("the server refused the key");
        assert!(is_key_refusal(&err.to_string()), "{err:#}");
        assert_eq!(server.await.unwrap(), 1, "a refusal was asked again");
    }
}

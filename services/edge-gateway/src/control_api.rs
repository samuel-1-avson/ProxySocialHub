//! Control API Client
//!
//! Handles communication between Edge Gateway and Control API
//! for node registration, heartbeats, and status updates.

use crate::error::{Error, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tracing::{debug, error, info, warn};

/// Client for Control API communication
pub struct ControlApiClient {
    client: Client,
    base_url: String,
    gateway_auth_secret: String,
}

/// Response from GET /v1/gateway/sessions/hydrate (Sprint J0).
#[derive(Debug, Deserialize)]
pub struct SessionHydrateResponse {
    pub username: String,
    #[serde(default)]
    pub source: String,
    pub session: crate::auth::SessionData,
}

/// Node registration request
#[derive(Debug, Clone, Serialize)]
pub struct RegisterNodeRequest {
    pub provider_user_id: String,
    pub node_id: String,
    pub ip_address: String,
    pub port: i32,
    pub region: String,
    pub country_code: String,
    pub city: String,
    pub isp: String,
    pub connection_type: String,
    pub version: String,
}

/// Node registration response
#[derive(Debug, Deserialize)]
pub struct RegisterNodeResponse {
    pub id: String,
    pub node_id: String,
    pub status: String,
    pub is_healthy: bool,
    pub quality_score: f64,
    pub current_tier: String,
    pub base_price_per_gb: f64,
    /// Authoritative ISP resolved by control-api GeoIP (GW-04).
    #[serde(default)]
    pub isp: String,
}

/// Heartbeat request
#[derive(Debug, Serialize)]
pub struct HeartbeatRequest {
    pub active_connections: i32,
    pub total_bytes_up: i64,
    pub total_bytes_down: i64,
    pub latency_ms: i32,
    pub is_healthy: bool,
}

/// Heartbeat response
#[derive(Debug, Deserialize)]
pub struct HeartbeatResponse {
    pub status: String,
    pub timestamp: String,
    pub quality_score: f64,
    pub current_tier: String,
    pub base_price_per_gb: f64,
    /// Authoritative ISP as currently stored by control-api (GW-04).
    #[serde(default)]
    pub isp: String,
}

/// Status update request
#[derive(Debug, Serialize)]
pub struct StatusUpdateRequest {
    pub is_healthy: bool,
    pub status: String,
    pub reason: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SessionIntentStateRequest {
    pub lifecycle_state: String,
    pub provider_node_id: Option<String>,
    pub target_host: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SessionIntentUsageRequest {
    pub provider_node_id: Option<String>,
    pub target_host: Option<String>,
    pub bytes_up_delta: i64,
    pub bytes_down_delta: i64,
}

/// Wave 5.B observe-only slash audit (no on-chain slash).
#[derive(Debug, Serialize)]
pub struct SlashAuditRequest {
    pub gateway_address: String,
    pub provider_id: String,
    pub session_id: String,
    pub reason: String,
    pub token_type: String,
    pub evidence: String,
}

impl ControlApiClient {
    /// Create a new Control API client
    pub fn new(base_url: &str, gateway_auth_secret: &str) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(10))
            .pool_idle_timeout(Duration::from_secs(30))
            .build()
            .expect("Failed to create HTTP client");

        Self {
            client,
            base_url: base_url.trim_end_matches('/').to_string(),
            gateway_auth_secret: gateway_auth_secret.to_string(),
        }
    }

    /// Register or update a node in Control API
    pub async fn register_node(&self, req: &RegisterNodeRequest) -> Result<RegisterNodeResponse> {
        let url = format!("{}/v1/gateway/nodes/register", self.base_url);

        debug!("Registering node with Control API: {}", req.node_id);

        let response = self
            .client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("X-Gateway-Auth", &self.gateway_auth_secret)
            .json(req)
            .send()
            .await
            .map_err(|e| {
                error!("Failed to send node registration request: {}", e);
                Error::Internal(format!("HTTP error: {}", e))
            })?;

        let status = response.status();

        if status.is_success() {
            let body = response.json::<RegisterNodeResponse>().await.map_err(|e| {
                error!("Failed to parse registration response: {}", e);
                Error::Internal(format!("Parse error: {}", e))
            })?;

            info!(
                "Node registered successfully: {} (DB ID: {})",
                body.node_id, body.id
            );

            Ok(body)
        } else {
            let text = response.text().await.unwrap_or_default();
            error!("Node registration failed ({}): {}", status, text);
            Err(Error::Internal(format!(
                "Registration failed: HTTP {} - {}",
                status, text
            )))
        }
    }

    /// Send heartbeat for a node
    pub async fn send_heartbeat(
        &self,
        db_node_id: &str,
        req: &HeartbeatRequest,
    ) -> Result<HeartbeatResponse> {
        let url = format!(
            "{}/v1/gateway/nodes/{}/heartbeat",
            self.base_url, db_node_id
        );

        debug!("Sending heartbeat for node: {}", db_node_id);

        let response = self
            .client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("X-Gateway-Auth", &self.gateway_auth_secret)
            .json(req)
            .send()
            .await
            .map_err(|e| {
                error!("Failed to send heartbeat: {}", e);
                Error::Internal(format!("HTTP error: {}", e))
            })?;

        let status = response.status();

        if status.is_success() {
            let body = response.json::<HeartbeatResponse>().await.map_err(|e| {
                error!("Failed to parse heartbeat response: {}", e);
                Error::Internal(format!("Parse error: {}", e))
            })?;

            debug!("Heartbeat sent successfully for node: {}", db_node_id);

            Ok(body)
        } else {
            let text = response.text().await.unwrap_or_default();
            warn!("Heartbeat failed ({}): {}", status, text);
            Err(Error::Internal(format!(
                "Heartbeat failed: HTTP {} - {}",
                status, text
            )))
        }
    }

    /// Update node status (online/offline)
    pub async fn update_status(
        &self,
        db_node_id: &str,
        is_healthy: bool,
        status: &str,
        reason: Option<&str>,
    ) -> Result<()> {
        let url = format!("{}/v1/gateway/nodes/{}/status", self.base_url, db_node_id);

        let req = StatusUpdateRequest {
            is_healthy,
            status: status.to_string(),
            reason: reason.map(|s| s.to_string()),
        };

        let response = self
            .client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("X-Gateway-Auth", &self.gateway_auth_secret)
            .json(&req)
            .send()
            .await
            .map_err(|e| {
                error!("Failed to send status update: {}", e);
                Error::Internal(format!("HTTP error: {}", e))
            })?;

        if response.status().is_success() {
            info!(
                "Node {} status updated: {} (healthy: {})",
                db_node_id, status, is_healthy
            );
            Ok(())
        } else {
            let text = response.text().await.unwrap_or_default();
            error!("Status update failed: {}", text);
            Err(Error::Internal(format!("Status update failed: {}", text)))
        }
    }

    pub async fn update_session_intent_state(
        &self,
        intent_id: &str,
        lifecycle_state: &str,
        provider_node_id: Option<&str>,
        target_host: Option<&str>,
    ) -> Result<()> {
        let url = format!(
            "{}/v1/gateway/session-intents/{}/state",
            self.base_url, intent_id
        );

        let req = SessionIntentStateRequest {
            lifecycle_state: lifecycle_state.to_string(),
            provider_node_id: provider_node_id.map(|value| value.to_string()),
            target_host: target_host.map(|value| value.to_string()),
        };

        let response = self
            .client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("X-Gateway-Auth", &self.gateway_auth_secret)
            .json(&req)
            .send()
            .await
            .map_err(|e| {
                error!("Failed to update session intent state: {}", e);
                Error::Internal(format!("HTTP error: {}", e))
            })?;

        if response.status().is_success() {
            debug!(
                "Session intent {} transitioned to {} via control API",
                intent_id, lifecycle_state
            );
            Ok(())
        } else {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            // W1.1: prepaid SessionEscrow not confirmed — fail closed on Active.
            if status.as_u16() == 402 || text.contains("session_escrow_required") {
                warn!(
                    "Session intent {} Active blocked (escrow required): {}",
                    intent_id, text
                );
                return Err(Error::SessionEscrowRequired(text));
            }
            warn!(
                "Session intent state update failed for {} ({}): {}",
                intent_id, lifecycle_state, text
            );
            Err(Error::Internal(format!(
                "Session intent state update failed: {}",
                text
            )))
        }
    }

    pub async fn update_session_intent_usage(
        &self,
        intent_id: &str,
        provider_node_id: Option<&str>,
        target_host: Option<&str>,
        bytes_up_delta: i64,
        bytes_down_delta: i64,
    ) -> Result<()> {
        let url = format!(
            "{}/v1/gateway/session-intents/{}/usage",
            self.base_url, intent_id
        );

        let req = SessionIntentUsageRequest {
            provider_node_id: provider_node_id.map(|value| value.to_string()),
            target_host: target_host.map(|value| value.to_string()),
            bytes_up_delta,
            bytes_down_delta,
        };

        let response = self
            .client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("X-Gateway-Auth", &self.gateway_auth_secret)
            .json(&req)
            .send()
            .await
            .map_err(|e| {
                error!("Failed to update session intent usage: {}", e);
                Error::Internal(format!("HTTP error: {}", e))
            })?;

        if response.status().is_success() {
            debug!(
                "Session intent {} usage delta synced: +{} up / +{} down",
                intent_id, bytes_up_delta, bytes_down_delta
            );
            Ok(())
        } else {
            let text = response.text().await.unwrap_or_default();
            warn!(
                "Session intent usage update failed for {}: {}",
                intent_id, text
            );
            Err(Error::Internal(format!(
                "Session intent usage update failed: {}",
                text
            )))
        }
    }

    /// Sprint J0: load session auth blob from control-api PG cache when Redis misses.
    pub async fn hydrate_session(
        &self,
        username: &str,
    ) -> Result<Option<crate::auth::SessionData>> {
        let url = format!(
            "{}/v1/gateway/sessions/hydrate?username={}",
            self.base_url,
            encode_query_component(username)
        );
        let response = self
            .client
            .get(&url)
            .header("X-Gateway-Auth", &self.gateway_auth_secret)
            .timeout(Duration::from_secs(3))
            .send()
            .await
            .map_err(|e| {
                warn!("session hydrate request failed for {}: {}", username, e);
                Error::Internal(format!("hydrate HTTP error: {e}"))
            })?;

        let status = response.status();
        if status.as_u16() == 404 {
            return Ok(None);
        }
        if !status.is_success() {
            let text = response.text().await.unwrap_or_default();
            warn!(
                "session hydrate rejected for {} ({}): {}",
                username, status, text
            );
            return Ok(None);
        }

        let body = response
            .json::<SessionHydrateResponse>()
            .await
            .map_err(|e| Error::Internal(format!("hydrate parse error: {e}")))?;
        debug!(
            username = %username,
            source = %body.source,
            "hydrated session from control-api"
        );
        Ok(Some(body.session))
    }

    /// Wave 5.B: record honeytoken hit as control-api slashing_events audit (observe only).
    pub async fn report_slash_audit(&self, req: &SlashAuditRequest) -> Result<()> {
        let url = format!("{}/v1/gateway/slash-audit", self.base_url);
        let response = self
            .client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("X-Gateway-Auth", &self.gateway_auth_secret)
            .json(req)
            .send()
            .await
            .map_err(|e| Error::Internal(format!("slash-audit HTTP error: {e}")))?;
        let status = response.status();
        if status.is_success() {
            debug!("slash-audit recorded (observe-only)");
            Ok(())
        } else {
            let text = response.text().await.unwrap_or_default();
            warn!("slash-audit failed ({}): {}", status, text);
            Err(Error::Internal(format!(
                "slash-audit failed: HTTP {status} - {text}"
            )))
        }
    }
}

fn encode_query_component(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for b in value.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_client_creation() {
        let client = ControlApiClient::new("http://localhost:8080", "test-secret");
        assert_eq!(client.base_url, "http://localhost:8080");
    }

    #[test]
    fn test_client_url_trimming() {
        let client = ControlApiClient::new("http://localhost:8080/", "test-secret");
        assert_eq!(client.base_url, "http://localhost:8080");
    }
}

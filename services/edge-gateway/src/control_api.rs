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

/// Node registration request
#[derive(Debug, Serialize)]
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
}

/// Status update request
#[derive(Debug, Serialize)]
pub struct StatusUpdateRequest {
    pub is_healthy: bool,
    pub status: String,
    pub reason: Option<String>,
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
        let url = format!(
            "{}/v1/gateway/nodes/{}/status",
            self.base_url, db_node_id
        );

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

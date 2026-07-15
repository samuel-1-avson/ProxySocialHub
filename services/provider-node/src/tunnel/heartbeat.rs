//! Heartbeat manager: sends periodic telemetry to the Edge Gateway.

use crate::ip::{fetch_provider_lease, ProviderLeaseGrant, ProviderLeaseRequest};
use crate::proofs::{HeartbeatPayload, ProviderProofEnvelope, ProviderSigner};
use crate::stats::Collector;
use futures_util::{AsyncReadExt, AsyncWriteExt};
use serde::Serialize;
use std::time::{Duration, Instant};
use tracing::{debug, error};

/// Heartbeat payload sent to the gateway.
#[derive(Serialize)]
struct HeartbeatMessage {
    node_id: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    provider_run_id: String,
    timestamp: i64,
    #[serde(skip_serializing_if = "String::is_empty")]
    provider_node_id: String,
    latency_ms: i32,
    active_connections: i32,
    bandwidth_usage: BandwidthUsage,
    system_stats: SystemStatsPayload,
    #[serde(skip_serializing_if = "String::is_empty")]
    provider_lease: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    proof: Option<ProviderProofEnvelope>,
}

#[derive(serde::Deserialize)]
struct PongResponse {
    latency_ms: u32,
}

#[derive(Serialize)]
struct BandwidthUsage {
    bytes_up: u64,
    bytes_down: u64,
    rate_up_kbps: u32,
    rate_down_kbps: u32,
}

#[derive(Serialize)]
struct SystemStatsPayload {
    cpu_percent: f32,
    memory_percent: f32,
    uptime_seconds: u64,
    goroutines: usize, // kept for protocol compat; always 0 in Rust
}

/// Manages periodic heartbeats over a Yamux control stream.
pub struct HeartbeatManager {
    ctrl: yamux::Control,
    node_id: String,
    interval: Duration,
    stats: Collector,
    control_api_url: String,
    auth_token: String,
    lease_request: ProviderLeaseRequest,
    current_lease: Option<CachedLease>,
    /// UUID from `provider.toml` `node_id` (POST /v1/provider/nodes); gateway uses `node_id` above.
    api_node_id: String,
    api_heartbeat_ticks: u32,
    provider_signer: Option<ProviderSigner>,
    provider_run_id: String,
}

#[derive(Clone, Debug)]
struct CachedLease {
    grant: ProviderLeaseGrant,
    fetched_at: Instant,
}

impl HeartbeatManager {
    pub fn new(
        ctrl: yamux::Control,
        node_id: String,
        interval: Duration,
        stats: Collector,
        control_api_url: String,
        auth_token: String,
        lease_request: ProviderLeaseRequest,
        api_node_id: String,
        provider_signer: Option<ProviderSigner>,
        provider_run_id: String,
    ) -> Self {
        Self {
            ctrl,
            node_id,
            interval,
            stats,
            control_api_url,
            auth_token,
            lease_request,
            current_lease: None,
            api_node_id,
            api_heartbeat_ticks: 0,
            provider_signer,
            provider_run_id,
        }
    }

    /// Run the heartbeat loop until cancelled or an error occurs.
    pub async fn run(mut self) {
        let mut ticker = tokio::time::interval(self.interval);
        // First tick fires immediately
        ticker.tick().await;

        loop {
            ticker.tick().await;

            if let Err(e) = self.send().await {
                error!("Heartbeat failed: {e}");
                break;
            }
        }
    }

    async fn send(&mut self) -> anyhow::Result<()> {
        let provider_lease = self.ensure_provider_lease().await.unwrap_or_else(|e| {
            error!("Provider lease renewal failed: {e}");
            self.current_lease
                .as_ref()
                .map(|lease| lease.grant.token.clone())
                .unwrap_or_default()
        });

        let mut stream = self
            .ctrl
            .open_stream()
            .await
            .map_err(|e| anyhow::anyhow!("failed to open heartbeat stream: {e}"))?;

        let msg = self.build_message(provider_lease);
        let data = serde_json::to_string(&msg)?;

        let frame = format!("HEARTBEAT:{}:{}:{}\n", msg.node_id, msg.timestamp, data);

        stream.write_all(frame.as_bytes()).await?;
        stream.flush().await?;

        // Read PONG response with latency
        let mut response_buf = [0u8; 1024];
        if let Ok(n) =
            tokio::time::timeout(Duration::from_secs(5), stream.read(&mut response_buf)).await?
        {
            if n > 0 {
                let resp_str = String::from_utf8_lossy(&response_buf[..n]);
                if resp_str.starts_with("PONG ") {
                    if let Ok(pong_data) =
                        serde_json::from_str::<PongResponse>(&resp_str[5..].trim())
                    {
                        self.stats.update_latency(pong_data.latency_ms as u64);
                    }
                }
            }
        }

        stream.close().await?;

        self.stats.update_heartbeat();

        self.maybe_send_api_heartbeat(&msg).await;

        debug!(
            active = msg.active_connections,
            up = msg.bandwidth_usage.bytes_up,
            down = msg.bandwidth_usage.bytes_down,
            rate_up = msg.bandwidth_usage.rate_up_kbps,
            rate_down = msg.bandwidth_usage.rate_down_kbps,
            "Heartbeat sent"
        );

        Ok(())
    }

    fn build_message(&self, provider_lease: String) -> HeartbeatMessage {
        let (rate_up, rate_down) = self.stats.compute_rate();
        let sys = crate::sys::collect();
        let snap = self.stats.snapshot();
        let timestamp = chrono_timestamp();
        let latency_ms = snap.latency_ms.min(i32::MAX as u64) as i32;
        let uptime_percent = 100.0_f64;
        let proof = self.provider_signer.as_ref().and_then(|signer| {
            if self.api_node_id.trim().is_empty() {
                return None;
            }
            Some(signer.sign_heartbeat(HeartbeatPayload {
                provider_node_id: &self.api_node_id,
                gateway_node_id: &self.node_id,
                latency_ms,
                active_connections: self.stats.active_connections(),
                uptime_percent,
                issued_at: timestamp,
            }))
        });

        HeartbeatMessage {
            node_id: self.node_id.clone(),
            provider_run_id: self.provider_run_id.clone(),
            timestamp,
            provider_node_id: self.api_node_id.clone(),
            latency_ms,
            active_connections: self.stats.active_connections(),
            bandwidth_usage: BandwidthUsage {
                bytes_up: self.stats.bytes_up(),
                bytes_down: self.stats.bytes_down(),
                rate_up_kbps: rate_up,
                rate_down_kbps: rate_down,
            },
            system_stats: SystemStatsPayload {
                cpu_percent: sys.cpu_percent,
                memory_percent: sys.memory_percent,
                uptime_seconds: self.stats.uptime().as_secs(),
                goroutines: 0,
            },
            provider_lease,
            proof,
        }
    }

    /// Control API expects a heartbeat about every 2 minutes; gateway ticks are 30s.
    async fn maybe_send_api_heartbeat(&mut self, msg: &HeartbeatMessage) {
        if self.api_node_id.is_empty() {
            return;
        }
        self.api_heartbeat_ticks += 1;
        if self.api_heartbeat_ticks % 4 != 0 {
            return;
        }

        if let Err(e) = crate::ip::send_provider_node_heartbeat(
            &self.control_api_url,
            &self.auth_token,
            &self.api_node_id,
            &self.provider_run_id,
            msg.latency_ms,
            msg.active_connections,
            100.0,
            msg.proof.clone(),
        )
        .await
        {
            error!("Control API heartbeat failed: {e}");
        }
    }

    async fn ensure_provider_lease(&mut self) -> anyhow::Result<String> {
        let needs_renewal = match self.current_lease.as_ref() {
            Some(lease) => {
                lease.fetched_at.elapsed().as_secs() >= lease.grant.renew_after_secs
                    || lease.fetched_at.elapsed().as_secs() >= lease.grant.expires_in
            }
            None => true,
        };

        if needs_renewal {
            let grant =
                fetch_provider_lease(&self.control_api_url, &self.auth_token, &self.lease_request)
                    .await?;
            let token = grant.token.clone();
            self.current_lease = Some(CachedLease {
                grant,
                fetched_at: Instant::now(),
            });
            return Ok(token);
        }

        Ok(self
            .current_lease
            .as_ref()
            .map(|lease| lease.grant.token.clone())
            .unwrap_or_default())
    }
}

fn chrono_timestamp() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

//! Heartbeat manager: sends periodic telemetry to the Edge Gateway.

use crate::ip::{
    exchange_gateway_token, fetch_provider_lease, gateway_token_needs_refresh, ProviderLeaseGrant,
    ProviderLeaseRequest,
};
use crate::proofs::{HeartbeatPayload, ProviderProofEnvelope, ProviderSigner};
use crate::stats::Collector;
use futures_util::{AsyncReadExt, AsyncWriteExt};
use serde::Serialize;
use std::time::{Duration, Instant};
use tracing::{debug, error, info, warn};

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
    /// Long-lived provider API key used to refresh gateway JWTs. Empty = jwt-only mode.
    api_key: String,
    auth_token: String,
    auth_expires_at: Option<Instant>,
    lease_request: ProviderLeaseRequest,
    current_lease: Option<CachedLease>,
    /// UUID from `provider.toml` `node_id` (POST /v1/provider/nodes); gateway uses `node_id` above.
    api_node_id: String,
    /// When we last successfully attempted a Control API node heartbeat (cadence gate).
    last_api_heartbeat: Option<Instant>,
    provider_signer: Option<ProviderSigner>,
    provider_run_id: String,
}

#[derive(Clone, Debug)]
struct CachedLease {
    grant: ProviderLeaseGrant,
    fetched_at: Instant,
}

/// Refresh gateway JWT this far before expiry.
const GATEWAY_TOKEN_REFRESH_SKEW: Duration = Duration::from_secs(5 * 60);

/// Control API node Online / listing activate cadence (after the immediate first send).
const API_HEARTBEAT_INTERVAL: Duration = Duration::from_secs(120);

impl HeartbeatManager {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        ctrl: yamux::Control,
        node_id: String,
        interval: Duration,
        stats: Collector,
        control_api_url: String,
        auth_token: String,
        api_key: String,
        auth_expires_in: Option<u64>,
        lease_request: ProviderLeaseRequest,
        api_node_id: String,
        provider_signer: Option<ProviderSigner>,
        provider_run_id: String,
    ) -> Self {
        let auth_expires_at =
            auth_expires_in.map(|secs| Instant::now() + Duration::from_secs(secs));
        Self {
            ctrl,
            node_id,
            interval,
            stats,
            control_api_url,
            api_key,
            auth_token,
            auth_expires_at,
            lease_request,
            current_lease: None,
            api_node_id,
            last_api_heartbeat: None,
            provider_signer,
            provider_run_id,
        }
    }

    /// Run the heartbeat loop until cancelled or an error occurs.
    ///
    /// Sends an immediate first heartbeat (tunnel + Control API) so dashboard
    /// Online / listing publish do not wait a full interval (~30s / ~120s).
    pub async fn run(mut self) {
        if let Err(e) = self.send().await {
            error!("Heartbeat failed: {e}");
            return;
        }

        let mut ticker = tokio::time::interval(self.interval);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        // Consume the immediate first tick so the next wait is a full interval.
        ticker.tick().await;

        loop {
            ticker.tick().await;

            if let Err(e) = self.send().await {
                error!("Heartbeat failed: {e}");
                break;
            }
        }
    }

    async fn ensure_gateway_auth(&mut self, force: bool) -> anyhow::Result<()> {
        if self.api_key.trim().is_empty() {
            return Ok(());
        }
        let needs = force
            || self
                .auth_expires_at
                .map(|exp| gateway_token_needs_refresh(exp, GATEWAY_TOKEN_REFRESH_SKEW))
                .unwrap_or(true);
        if !needs {
            return Ok(());
        }
        let access = exchange_gateway_token(&self.control_api_url, self.api_key.trim()).await?;
        self.auth_token = access.token;
        self.auth_expires_at = Some(access.expires_at);
        info!(
            expires_in_secs = access.expires_in,
            "Refreshed gateway JWT for Control API heartbeats"
        );
        Ok(())
    }

    async fn send(&mut self) -> anyhow::Result<()> {
        if let Err(e) = self.ensure_gateway_auth(false).await {
            warn!("Gateway JWT refresh failed (will retry with current token): {e}");
        }

        let provider_lease = match self.ensure_provider_lease().await {
            Ok(token) => token,
            Err(e) => {
                let msg = e.to_string();
                let mut recovered = None;
                if msg.contains("401") || msg.contains("Unauthorized") {
                    match self.ensure_gateway_auth(true).await {
                        Ok(()) => match self.ensure_provider_lease().await {
                            Ok(token) => recovered = Some(token),
                            Err(retry_err) => {
                                error!(
                                    "Provider lease renewal failed after JWT refresh: {retry_err}"
                                )
                            }
                        },
                        Err(refresh_err) => {
                            error!("Gateway JWT force-refresh failed: {refresh_err}");
                        }
                    }
                } else {
                    error!("Provider lease renewal failed: {e}");
                }
                recovered.unwrap_or_else(|| {
                    self.current_lease
                        .as_ref()
                        .map(|lease| lease.grant.token.clone())
                        .unwrap_or_default()
                })
            }
        };

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
                if let Some(pong_body) = resp_str.strip_prefix("PONG ") {
                    if let Ok(pong_data) = serde_json::from_str::<PongResponse>(pong_body.trim()) {
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
        // Prefer Control API UUID; fall back to gateway runtime id so signed
        // heartbeats are not skipped when provider.toml omits node_id (enforce mode).
        let provider_node_id = if self.api_node_id.trim().is_empty() {
            self.node_id.as_str()
        } else {
            self.api_node_id.as_str()
        };
        let proof = self.provider_signer.as_ref().map(|signer| {
            signer.sign_heartbeat(HeartbeatPayload {
                provider_node_id,
                gateway_node_id: &self.node_id,
                latency_ms,
                active_connections: self.stats.active_connections(),
                uptime_percent,
                issued_at: timestamp,
            })
        });

        HeartbeatMessage {
            node_id: self.node_id.clone(),
            provider_run_id: self.provider_run_id.clone(),
            timestamp,
            provider_node_id: provider_node_id.to_string(),
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

    /// Control API Online / listing activate: send on first tunnel HB, then every ~2 minutes.
    async fn maybe_send_api_heartbeat(&mut self, msg: &HeartbeatMessage) {
        if self.api_node_id.is_empty() {
            return;
        }
        if let Some(last) = self.last_api_heartbeat {
            if last.elapsed() < API_HEARTBEAT_INTERVAL {
                return;
            }
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
            let err_msg = e.to_string();
            if (err_msg.contains("401") || err_msg.contains("Unauthorized"))
                && self.ensure_gateway_auth(true).await.is_ok()
            {
                if let Err(retry) = crate::ip::send_provider_node_heartbeat(
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
                    error!("Control API heartbeat failed after JWT refresh: {retry}");
                    return;
                }
            } else if let Some(suggested) = crate::ip::suggested_node_id_from_heartbeat_error(&e) {
                if suggested != self.api_node_id {
                    warn!(
                        old_node_id = %self.api_node_id,
                        new_node_id = %suggested,
                        "Control API node_id missing/deleted — rebinding to suggested active node; update provider.toml node_id"
                    );
                    self.api_node_id = suggested;
                    if let Err(retry) = crate::ip::send_provider_node_heartbeat(
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
                        error!("Control API heartbeat failed after node rebind: {retry}");
                        return;
                    }
                } else {
                    error!("Control API heartbeat failed: {e}");
                    return;
                }
            } else {
                error!("Control API heartbeat failed: {e}");
                return;
            }
        }

        self.last_api_heartbeat = Some(Instant::now());
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

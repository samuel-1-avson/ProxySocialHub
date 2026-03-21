//! Heartbeat manager: sends periodic telemetry to the Edge Gateway.

use crate::stats::Collector;
use futures_util::AsyncWriteExt;
use serde::Serialize;
use std::time::Duration;
use tracing::{debug, error};

/// Heartbeat payload sent to the gateway.
#[derive(Serialize)]
struct HeartbeatMessage {
    node_id: String,
    timestamp: i64,
    active_connections: i32,
    bandwidth_usage: BandwidthUsage,
    system_stats: SystemStatsPayload,
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
}

impl HeartbeatManager {
    pub fn new(
        ctrl: yamux::Control,
        node_id: String,
        interval: Duration,
        stats: Collector,
    ) -> Self {
        Self {
            ctrl,
            node_id,
            interval,
            stats,
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
        let mut stream = self
            .ctrl
            .open_stream()
            .await
            .map_err(|e| anyhow::anyhow!("failed to open heartbeat stream: {e}"))?;

        let msg = self.build_message();
        let data = serde_json::to_string(&msg)?;

        let frame = format!(
            "HEARTBEAT:{}:{}:{}\n",
            msg.node_id, msg.timestamp, data
        );

        stream.write_all(frame.as_bytes()).await?;
        stream.flush().await?;

        // Read PONG response with latency
        let mut response_buf = [0u8; 1024];
        if let Ok(n) = tokio::time::timeout(Duration::from_secs(5), stream.read(&mut response_buf)).await? {
            if n > 0 {
                let resp_str = String::from_utf8_lossy(&response_buf[..n]);
                if resp_str.starts_with("PONG ") {
                    if let Ok(pong_data) = serde_json::from_str::<PongResponse>(&resp_str[5..].trim()) {
                        self.stats.update_latency(pong_data.latency_ms as u64);
                    }
                }
            }
        }

        stream.close().await?;

        self.stats.update_heartbeat();

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

    fn build_message(&self) -> HeartbeatMessage {
        let (rate_up, rate_down) = self.stats.compute_rate();
        let sys = crate::sys::collect();

        HeartbeatMessage {
            node_id: self.node_id.clone(),
            timestamp: chrono_timestamp(),
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
        }
    }
}

fn chrono_timestamp() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

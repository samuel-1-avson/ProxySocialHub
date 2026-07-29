//! P4: multiple parallel yamux tunnels to the same gateway (`YAMUX_CONNS_PER_NODE`).

use crate::config::Config;
use crate::proofs::ProviderSigner;
use crate::proxy::handler::ProxyHandler;
use crate::stats::Collector;
use crate::tunnel::client::TunnelClient;
use crate::tunnel::heartbeat::HeartbeatManager;

use anyhow::Result;
use futures::future::select_all;
use std::sync::Arc;
use std::time::Duration;
use tracing::{info, warn};

const MAX_YAMUX_LANES: usize = 16;

pub fn normalize_lane_count(n: usize) -> usize {
    n.clamp(1, MAX_YAMUX_LANES)
}

/// Run `lane_count` yamux sessions to `cfg.gateway_addr` until the bundle drops.
pub async fn run_mux_lanes(
    cfg: Config,
    stats: Collector,
    provider_signer: Option<ProviderSigner>,
    lane_count: usize,
    provider_run_id: String,
) -> Result<()> {
    let lane_count = normalize_lane_count(lane_count);
    if lane_count == 1 {
        return run_single_lane(cfg, stats, provider_signer, 0, provider_run_id).await;
    }

    info!(lane_count, gateway = %cfg.gateway_addr, "Starting multi-yamux provider session");

    // Primary lane first so the gateway registers before attach lanes connect.
    let mut primary = TunnelClient::new(&cfg, stats.clone(), provider_run_id.clone());
    primary.connect().await?;
    let mut shared_cfg = cfg.clone();
    if !primary.auth_token().is_empty() {
        shared_cfg.jwt_token = primary.auth_token();
    }

    let hb = HeartbeatManager::new(
        primary.session_handle(),
        primary.runtime_node_id(),
        Duration::from_secs(30),
        stats.clone(),
        primary.control_api_url(),
        primary.auth_token(),
        primary.api_key(),
        primary.gateway_token_expires_in(),
        primary.provider_lease_request(),
        shared_cfg.node_id.clone(),
        provider_signer.clone(),
        provider_run_id.clone(),
    );
    let hb_handle = tokio::spawn(async move { hb.run().await });

    let handler = Arc::new(ProxyHandler::new(&shared_cfg, stats.clone()));
    let primary_handle = {
        let handler = handler.clone();
        tokio::spawn(async move {
            let lane_result = primary.accept_streams((*handler).clone()).await;
            warn!(?lane_result, lane = 0, "Primary yamux lane ended");
        })
    };

    let mut lane_handles = vec![primary_handle];

    for lane in 1..lane_count {
        let mut client = TunnelClient::new(&shared_cfg, stats.clone(), provider_run_id.clone());
        match client.connect().await {
            Ok(()) => info!(lane, "Secondary yamux lane connected"),
            Err(err) => {
                warn!(lane, error = %err, "Secondary yamux lane failed to connect");
                continue;
            }
        }
        let handler = handler.clone();
        lane_handles.push(tokio::spawn(async move {
            let lane_result = client.accept_streams((*handler).clone()).await;
            warn!(?lane_result, lane, "Secondary yamux lane ended");
        }));
    }

    let (finished, _, rest) = select_all(lane_handles).await;
    for handle in rest {
        handle.abort();
    }
    hb_handle.abort();
    let _ = finished;

    Err(anyhow::anyhow!("multi-yamux session ended"))
}

async fn run_single_lane(
    cfg: Config,
    stats: Collector,
    provider_signer: Option<ProviderSigner>,
    lane: usize,
    provider_run_id: String,
) -> Result<()> {
    let mut client = TunnelClient::new(&cfg, stats.clone(), provider_run_id.clone());
    client.connect().await?;

    let hb = HeartbeatManager::new(
        client.session_handle(),
        client.runtime_node_id(),
        Duration::from_secs(30),
        stats.clone(),
        client.control_api_url(),
        client.auth_token(),
        client.api_key(),
        client.gateway_token_expires_in(),
        client.provider_lease_request(),
        cfg.node_id.clone(),
        provider_signer,
        provider_run_id,
    );
    let hb_handle = tokio::spawn(async move { hb.run().await });

    let handler = ProxyHandler::new(&cfg, stats);
    let accept_result = client.accept_streams(handler).await;
    hb_handle.abort();
    client.close().await;
    warn!(?accept_result, lane, "Yamux lane ended");
    Err(anyhow::anyhow!("connection lost"))
}

#[cfg(test)]
mod tests {
    use super::normalize_lane_count;

    #[test]
    fn lane_count_clamped() {
        assert_eq!(normalize_lane_count(0), 1);
        assert_eq!(normalize_lane_count(1), 1);
        assert_eq!(normalize_lane_count(4), 4);
        assert_eq!(normalize_lane_count(99), 16);
    }
}

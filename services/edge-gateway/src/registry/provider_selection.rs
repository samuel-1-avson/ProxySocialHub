//! Directory-aware provider selection (P3.1).

use crate::auth::SessionAuthenticator;
use crate::config::EdgeMode;
use crate::state::AppState;
use std::sync::Arc;
use yamux::Control;

/// Where the buyer tunnel terminates: local yamux or a peer edge pod.
#[derive(Clone, Debug)]
pub enum ProviderTarget {
    Local {
        control: Control,
        node_id: String,
    },
    Remote {
        node_id: String,
        peer_base_url: String,
    },
}

/// Select the best provider route for a buyer CONNECT (local control or peer forward).
pub async fn select_provider_route(
    state: Arc<AppState>,
    session_id: &str,
    is_sticky: bool,
    authenticator: Arc<SessionAuthenticator>,
    target_geo: Option<&str>,
    target_domain: Option<&str>,
) -> std::io::Result<Option<ProviderTarget>> {
    let node_id = match select_provider_node_id(
        state.clone(),
        session_id,
        is_sticky,
        authenticator.clone(),
        target_geo,
        target_domain,
    )
    .await?
    {
        Some(id) => id,
        None => {
            if !state.config.edge_mode.uses_multipod_directory() {
                return Ok(None);
            }
            match pick_from_directory(state.clone(), target_geo).await? {
                Some(id) => id,
                None => return Ok(None),
            }
        }
    };

    match resolve_target(state, &node_id).await? {
        Some(t) => Ok(Some(t)),
        None => {
            record_route_miss();
            Ok(None)
        }
    }
}

async fn resolve_target(
    state: Arc<AppState>,
    node_id: &str,
) -> std::io::Result<Option<ProviderTarget>> {
    if let Some(control) = state.registry.get_by_id(node_id) {
        crate::metrics::record_provider_route("local");
        return Ok(Some(ProviderTarget::Local {
            control,
            node_id: node_id.to_string(),
        }));
    }

    let ownership = match state.provider_directory.lookup(node_id).await {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(node_id = %node_id, error = %e, "Provider directory lookup failed");
            return Ok(None);
        }
    };

    let Some(ownership) = ownership else {
        return Ok(None);
    };

    if state.provider_directory.is_local_owner(&ownership.pod_id) {
        tracing::warn!(
            node_id = %node_id,
            "Directory claims local pod but no local Control handle"
        );
        return Ok(None);
    }

    let Some(forward_base_url) = state.config.owner_forward_base_url(&ownership.pod_id) else {
        let map_hint = if state.config.edge_mode == EdgeMode::Split {
            "TUNNEL_GW_ADDRS"
        } else {
            "EDGE_PEER_URLS"
        };
        tracing::warn!(
            node_id = %node_id,
            owner_pod = %ownership.pod_id,
            map = map_hint,
            "No forward URL for owner pod"
        );
        return Ok(None);
    };

    let route_label = if state.config.edge_mode == EdgeMode::Split {
        "tunnel_remote"
    } else {
        "remote"
    };
    crate::metrics::record_provider_route(route_label);
    Ok(Some(ProviderTarget::Remote {
        node_id: node_id.to_string(),
        peer_base_url: forward_base_url,
    }))
}

fn record_route_miss() {
    crate::metrics::record_provider_route("miss");
}

fn geo_matches(
    record: &crate::registry::directory::ProviderOwnership,
    target_geo: Option<&str>,
) -> bool {
    let Some(geo) = target_geo.filter(|g| !g.is_empty()) else {
        return true;
    };
    if record.country_code.is_empty() {
        return true;
    }
    record.country_code.eq_ignore_ascii_case(geo)
}

fn score_record(record: &crate::registry::directory::ProviderOwnership) -> f64 {
    let latency_penalty = record.latency_ms as f64;
    record.quality_score * 1000.0 - latency_penalty
}

async fn pick_from_directory(
    state: Arc<AppState>,
    target_geo: Option<&str>,
) -> std::io::Result<Option<String>> {
    let records = match state.provider_directory.list_all().await {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(error = %e, "Failed to list provider directory");
            return Ok(None);
        }
    };

    let mut candidates: Vec<_> = records
        .into_iter()
        .filter(|r| r.is_healthy)
        .filter(|r| geo_matches(r, target_geo))
        .collect();

    candidates.sort_by(|a, b| {
        score_record(b)
            .partial_cmp(&score_record(a))
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    for record in candidates {
        if resolve_target(state.clone(), &record.node_id)
            .await?
            .is_some()
        {
            return Ok(Some(record.node_id));
        }
    }

    Ok(None)
}

/// Local-registry-first node id selection (sticky / shard / ML / random).
async fn select_provider_node_id(
    state: Arc<AppState>,
    session_id: &str,
    is_sticky: bool,
    authenticator: Arc<SessionAuthenticator>,
    target_geo: Option<&str>,
    target_domain: Option<&str>,
) -> std::io::Result<Option<String>> {
    let sticky_ttl_secs = state.config.sticky_ttl_secs;

    let needs_rotation = if !is_sticky && !session_id.is_empty() {
        state
            .rotation
            .lock()
            .map(|mut mgr| {
                let rot = mgr.get_or_create(session_id);
                let _ = rot.record_request();
                rot.should_rotate()
            })
            .unwrap_or(false)
    } else {
        false
    };

    let sticky_node_id = if is_sticky && !needs_rotation && !session_id.is_empty() {
        match authenticator.get_sticky_node(session_id).await {
            Ok(Some(node_id)) => Some(node_id),
            Ok(None) => None,
            Err(e) => {
                tracing::error!("Failed to get sticky binding: {}", e);
                None
            }
        }
    } else {
        None
    };

    let node_id = if let Some(ref bound_node_id) = sticky_node_id {
        if state.registry.get_by_id(bound_node_id).is_some() {
            Some(bound_node_id.clone())
        } else if state.config.edge_mode.uses_multipod_directory() {
            if state
                .provider_directory
                .lookup(bound_node_id)
                .await
                .ok()
                .flatten()
                .is_some()
            {
                Some(bound_node_id.clone())
            } else {
                state
                    .registry
                    .get_best_for(target_geo, None)
                    .map(|(_, id)| id)
            }
        } else {
            state
                .registry
                .get_best_for(target_geo, None)
                .map(|(_, id)| id)
        }
    } else if let Some((_, node_id)) = state.registry.get_best_for(target_geo, None) {
        Some(node_id)
    } else if let Some((_, node_id)) = state.select_provider_ml(target_domain) {
        Some(node_id)
    } else {
        use rand::seq::SliceRandom;
        let healthy: Vec<_> = state
            .registry
            .list_nodes()
            .into_iter()
            .filter(|n| n.is_healthy)
            .collect();
        healthy
            .choose(&mut rand::thread_rng())
            .map(|n| n.node_id.clone())
    };

    if let Some(ref id) = node_id {
        if is_sticky && sticky_node_id.is_none() && !session_id.is_empty() {
            if let Err(e) = authenticator
                .set_sticky_node(session_id, id, sticky_ttl_secs)
                .await
            {
                tracing::error!("Failed to set sticky binding: {}", e);
            }
        }
        if needs_rotation {
            if let Ok(mut mgr) = state.rotation.lock() {
                mgr.get_or_create(session_id).assign_node(id.clone());
            }
        }
    }

    Ok(node_id)
}

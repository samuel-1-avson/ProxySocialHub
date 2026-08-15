//! Directory-aware provider selection (P3.1).

use crate::auth::SessionAuthenticator;
use crate::config::EdgeMode;
use crate::registry::lockfree::LockFreeNodeRegistry;
use crate::rotation::config_from_session_claims;
use crate::state::AppState;
use std::sync::Arc;
use tracing::Instrument;
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
    pinned_node_id: Option<&str>,
    target_isp: Option<&str>,
    rotation_type: Option<&str>,
    rotation_interval_seconds: Option<u32>,
) -> std::io::Result<Option<ProviderTarget>> {
    let span = crate::observability::provider_select_span(session_id, target_domain);
    select_provider_route_inner(
        state,
        session_id,
        is_sticky,
        authenticator,
        target_geo,
        target_domain,
        pinned_node_id,
        target_isp,
        rotation_type,
        rotation_interval_seconds,
    )
    .instrument(span)
    .await
}

async fn select_provider_route_inner(
    state: Arc<AppState>,
    session_id: &str,
    is_sticky: bool,
    authenticator: Arc<SessionAuthenticator>,
    target_geo: Option<&str>,
    target_domain: Option<&str>,
    pinned_node_id: Option<&str>,
    target_isp: Option<&str>,
    rotation_type: Option<&str>,
    rotation_interval_seconds: Option<u32>,
) -> std::io::Result<Option<ProviderTarget>> {
    let node_id = match select_provider_node_id(
        state.clone(),
        session_id,
        is_sticky,
        authenticator.clone(),
        target_geo,
        target_domain,
        pinned_node_id,
        target_isp,
        rotation_type,
        rotation_interval_seconds,
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

    let edge_mode = state.config.edge_mode;
    match resolve_target(state, &node_id).await? {
        Some(t) => {
            let route = match &t {
                ProviderTarget::Local { .. } => "local",
                ProviderTarget::Remote { .. } => {
                    if edge_mode == EdgeMode::Split {
                        "tunnel_remote"
                    } else {
                        "remote"
                    }
                }
            };
            tracing::Span::current().record("provider.node_id", tracing::field::display(&node_id));
            tracing::Span::current().record("provider.route", route);
            Ok(Some(t))
        }
        None => {
            record_route_miss();
            tracing::Span::current().record("provider.route", "miss");
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
async fn pinned_node_available(
    state: Arc<AppState>,
    pinned_node_id: &str,
) -> std::io::Result<bool> {
    if state.registry.get_by_id(pinned_node_id).is_some() {
        return Ok(true);
    }
    if !state.config.edge_mode.uses_multipod_directory() {
        return Ok(false);
    }
    match state.provider_directory.lookup(pinned_node_id).await {
        Ok(Some(_)) => Ok(true),
        Ok(None) => Ok(false),
        Err(e) => {
            tracing::warn!(node_id = %pinned_node_id, error = %e, "Pinned node directory lookup failed");
            Ok(false)
        }
    }
}

async fn select_provider_node_id(
    state: Arc<AppState>,
    session_id: &str,
    is_sticky: bool,
    authenticator: Arc<SessionAuthenticator>,
    target_geo: Option<&str>,
    target_domain: Option<&str>,
    pinned_node_id: Option<&str>,
    target_isp: Option<&str>,
    rotation_type: Option<&str>,
    rotation_interval_seconds: Option<u32>,
) -> std::io::Result<Option<String>> {
    if let Some(pinned) = pinned_node_id.filter(|id| !id.is_empty()) {
        if pinned_node_available(state.clone(), pinned).await? {
            return Ok(Some(pinned.to_string()));
        }
        tracing::warn!(
            node_id = %pinned,
            session_id = %session_id,
            "Pinned marketplace provider node is not available"
        );
        return Ok(None);
    }

    let sticky_ttl_secs = state.config.sticky_ttl_secs;
    let rot_type = rotation_type.unwrap_or("");
    let rot_interval = rotation_interval_seconds.unwrap_or(0);

    let needs_rotation = if !is_sticky && !session_id.is_empty() {
        state
            .rotation
            .lock()
            .map(|mut mgr| {
                let cfg = config_from_session_claims(rot_type, rot_interval);
                let rot = mgr.create_with_config(session_id, cfg);
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

    let mut sticky_rebound = false;
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
                sticky_rebound = true;
                tracing::warn!(
                    dead_node = %bound_node_id,
                    session_id = %session_id,
                    "sticky binding node unavailable — selecting replacement"
                );
                state
                    .registry
                    .get_best_for(target_geo, None)
                    .map(|(_, id)| id)
            }
        } else {
            sticky_rebound = true;
            tracing::warn!(
                dead_node = %bound_node_id,
                session_id = %session_id,
                "sticky binding node unavailable — selecting replacement"
            );
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

    // GW-04: honor buyer ISP targeting. A mismatched primary falls back to an
    // ISP-filtered fresh candidate list; a pinned marketplace node that does
    // not verifiably match the requested ISP is rejected outright (the buyer
    // explicitly asked for a specific ISP).
    let node_id = if let Some(isp) = target_isp.filter(|s| !s.is_empty()) {
        let primary_ok = node_id
            .as_deref()
            .map(|id| node_matches_isp(&state.registry, id, isp))
            .unwrap_or(false);
        if primary_ok {
            node_id
        } else if pinned_node_id.filter(|p| !p.is_empty()).is_some() {
            tracing::warn!(
                node_id = ?node_id,
                %isp,
                session_id = %session_id,
                "pinned provider does not verifiably match requested ISP — rejecting"
            );
            None
        } else {
            let candidates = isp_filtered_candidates(&state.registry, target_geo, isp);
            if candidates.is_empty() {
                tracing::warn!(
                    %isp,
                    session_id = %session_id,
                    "no providers verifiably match requested ISP"
                );
                None
            } else {
                // ISP override may change the sticky node — refresh binding below.
                sticky_rebound = sticky_node_id
                    .as_ref()
                    .map(|bound| candidates.first().map(|c| c != bound).unwrap_or(true))
                    .unwrap_or(sticky_rebound);
                tracing::info!(%isp, count = candidates.len(), "ISP-filtered candidates");
                candidates.into_iter().next()
            }
        }
    } else {
        node_id
    };

    if let Some(ref id) = node_id {
        // Always refresh sticky TTL and rebind when the selected node differs
        // from a dead prior binding (P1-2).
        if is_sticky && !session_id.is_empty() {
            if sticky_rebound || sticky_node_id.as_ref() != Some(id) {
                tracing::info!(
                    session_id = %session_id,
                    node_id = %id,
                    prior = ?sticky_node_id,
                    rebound = sticky_rebound,
                    "sticky session bound/rebound"
                );
            }
            if let Err(e) = authenticator
                .set_sticky_node(session_id, id, sticky_ttl_secs)
                .await
            {
                tracing::error!("Failed to set sticky binding: {}", e);
            }
        }
        if !is_sticky && !session_id.is_empty() {
            if let Ok(mut mgr) = state.rotation.lock() {
                let cfg = config_from_session_claims(rot_type, rot_interval);
                mgr.create_with_config(session_id, cfg)
                    .assign_node(id.clone());
            }
        }
    }

    Ok(node_id)
}

/// Node id routing would assign for this session (honeytoken slash / audit only; no tunnel opened).
pub async fn attribution_node_id(
    state: Arc<AppState>,
    session_id: &str,
    is_sticky: bool,
    authenticator: Arc<SessionAuthenticator>,
    target_geo: Option<&str>,
    target_domain: Option<&str>,
    pinned_node_id: Option<&str>,
) -> Option<String> {
    // Honeytoken attribution does not gate on ISP targeting.
    select_provider_node_id(
        state,
        session_id,
        is_sticky,
        authenticator,
        target_geo,
        target_domain,
        pinned_node_id,
        None,
        None,
        None,
    )
    .await
    .ok()
    .flatten()
}

/// GW-04: does this node verifiably match the buyer's requested ISP?
/// Unknown ISP on the node side counts as non-match — an explicit ISP request
/// must not silently land on an unverified exit.
pub fn node_matches_isp(
    registry: &LockFreeNodeRegistry,
    node_id: &str,
    target_isp: &str,
) -> bool {
    match registry.get_node_info(node_id) {
        Some(info) => !info.isp.is_empty() && info.isp.eq_ignore_ascii_case(target_isp),
        None => false,
    }
}

/// ISP-filtered fresh candidates for buyer selection (GW-04).
pub fn isp_filtered_candidates(
    registry: &LockFreeNodeRegistry,
    target_geo: Option<&str>,
    target_isp: &str,
) -> Vec<String> {
    filtered_candidates(
        registry,
        &std::collections::HashSet::new(),
        target_geo,
        Some(target_isp),
    )
}

/// Up-to-N alternates for provider failover (GW-06), honoring the buyer's
/// geo/ISP constraints and skipping already-failed nodes.
pub fn failover_candidates(
    registry: &LockFreeNodeRegistry,
    exclude: &std::collections::HashSet<String>,
    target_geo: Option<&str>,
    target_isp: Option<&str>,
) -> Vec<String> {
    filtered_candidates(registry, exclude, target_geo, target_isp)
}

fn filtered_candidates(
    registry: &LockFreeNodeRegistry,
    exclude: &std::collections::HashSet<String>,
    target_geo: Option<&str>,
    target_isp: Option<&str>,
) -> Vec<String> {
    filter_node_infos(registry.list_nodes(), exclude, target_geo, target_isp)
}

/// Pure candidate filter/sort (health, lease freshness, exclusions, geo, ISP)
/// — split out for unit testing without a live yamux control.
fn filter_node_infos(
    infos: Vec<crate::state::NodeInfo>,
    exclude: &std::collections::HashSet<String>,
    target_geo: Option<&str>,
    target_isp: Option<&str>,
) -> Vec<String> {
    use crate::auth::provider_lease::{lease_is_fresh, provider_leases_required};

    let mut scored: Vec<(f64, u32, String)> = infos
        .into_iter()
        .filter(|n| n.is_healthy)
        .filter(|n| !provider_leases_required() || lease_is_fresh(n.lease_expires_at))
        .filter(|n| !exclude.contains(&n.node_id))
        .filter(|n| {
            target_geo
                .map(|g| g.is_empty() || n.country_code.eq_ignore_ascii_case(g))
                .unwrap_or(true)
        })
        .filter(|n| match target_isp {
            Some(isp) if !isp.is_empty() => {
                !n.isp.is_empty() && n.isp.eq_ignore_ascii_case(isp)
            }
            _ => true,
        })
        .map(|n| (n.quality_score, n.latency_ms, n.node_id))
        .collect();

    scored.sort_by(|a, b| {
        b.0.partial_cmp(&a.0)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.1.cmp(&b.1))
    });
    scored.into_iter().map(|(_, _, id)| id).collect()
}

#[cfg(test)]
mod filter_tests {
    use super::*;
    use crate::state::NodeInfo;

    fn info(id: &str, country: &str, isp: &str, healthy: bool, score: f64, latency: u32) -> NodeInfo {
        let mut n = NodeInfo::new(id.to_string(), "1.2.3.4".to_string(), None);
        n.country_code = country.to_string();
        n.isp = isp.to_string();
        n.is_healthy = healthy;
        n.quality_score = score;
        n.latency_ms = latency;
        n
    }

    #[test]
    fn isp_filter_matches_case_insensitively() {
        let nodes = vec![
            info("a", "US", "Comcast", true, 90.0, 20),
            info("b", "US", "Verizon", true, 95.0, 10),
            info("c", "US", "", true, 99.0, 5), // unknown ISP must not match
        ];
        let out = filter_node_infos(nodes, &Default::default(), None, Some("comcast"));
        assert_eq!(out, vec!["a".to_string()]);
    }

    #[test]
    fn isp_filter_combined_with_geo() {
        let nodes = vec![
            info("a", "US", "Comcast", true, 90.0, 20),
            info("b", "DE", "Comcast", true, 95.0, 10), // wrong country
        ];
        let out = filter_node_infos(nodes, &Default::default(), Some("US"), Some("Comcast"));
        assert_eq!(out, vec!["a".to_string()]);
    }

    #[test]
    fn failover_filter_excludes_failed_and_sorts_by_score() {
        let nodes = vec![
            info("dead", "US", "Comcast", true, 99.0, 1),
            info("slow", "US", "Comcast", true, 90.0, 50),
            info("best", "US", "Comcast", true, 95.0, 30),
            info("sick", "US", "Comcast", false, 100.0, 1), // unhealthy dropped
        ];
        let exclude: std::collections::HashSet<String> = ["dead".to_string()].into_iter().collect();
        let out = filter_node_infos(nodes, &exclude, None, Some("Comcast"));
        assert_eq!(out, vec!["best".to_string(), "slow".to_string()]);
    }

    #[test]
    fn no_isp_request_passes_all_healthy() {
        let nodes = vec![
            info("a", "US", "", true, 90.0, 20),
            info("b", "DE", "Comcast", true, 80.0, 10),
        ];
        let out = filter_node_infos(nodes, &Default::default(), None, None);
        assert_eq!(out.len(), 2);
    }
}

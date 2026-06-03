//! Pod drain helpers (P3a): stop new traffic, release Redis ownership on shutdown.

use crate::state::AppState;
use http_body_util::Full;
use hyper::body::Bytes;
use hyper::{Response, StatusCode};
use std::sync::atomic::Ordering;
use std::sync::Arc;

pub fn is_draining(state: &AppState) -> bool {
    state.draining.load(Ordering::Relaxed)
}

pub fn set_draining(state: &AppState, draining: bool) {
    state.draining.store(draining, Ordering::SeqCst);
}

pub async fn release_directory_ownership(state: &AppState) -> Result<usize, String> {
    state
        .provider_directory
        .release_all_owned()
        .await
        .map_err(|e| e.to_string())
}

pub async fn directory_stats_json(state: &AppState) -> Result<String, String> {
    let total = state
        .provider_directory
        .list_all()
        .await
        .map_err(|e| e.to_string())?
        .len();
    let owned_here = state
        .provider_directory
        .count_owned()
        .await
        .map_err(|e| e.to_string())?;
    let local_nodes = state.registry.list_nodes().len();
    let body = serde_json::json!({
        "pod_id": state.provider_directory.pod_id(),
        "draining": is_draining(state),
        "directory_total": total,
        "directory_owned_here": owned_here,
        "local_registry_nodes": local_nodes,
        "edge_mode": format!("{:?}", state.config.edge_mode),
    });
    serde_json::to_string(&body).map_err(|e| e.to_string())
}

pub fn json_response(status: StatusCode, body: String) -> Response<Full<Bytes>> {
    Response::builder()
        .status(status)
        .header("Content-Type", "application/json")
        .body(Full::new(Bytes::from(body)))
        .expect("response build")
}

pub async fn admin_drain_handler(state: Arc<AppState>) -> Response<Full<Bytes>> {
    set_draining(&state, true);
    crate::metrics::record_connection_error("pod_draining");
    let body = serde_json::json!({
        "draining": true,
        "pod_id": state.provider_directory.pod_id(),
        "message": "New buyer and provider connections rejected; call POST /admin/drain/ownership after sessions drain, or wait for SIGTERM",
    });
    json_response(
        StatusCode::OK,
        serde_json::to_string(&body).unwrap_or_else(|_| "{}".into()),
    )
}

pub async fn admin_drain_ownership_handler(state: Arc<AppState>) -> Response<Full<Bytes>> {
    if !is_draining(&state) {
        let body = serde_json::json!({
            "error": "pod not draining; POST /admin/drain first",
        });
        return json_response(
            StatusCode::BAD_REQUEST,
            serde_json::to_string(&body).unwrap_or_default(),
        );
    }
    match release_directory_ownership(&state).await {
        Ok(released) => {
            let body = serde_json::json!({
                "released": released,
                "pod_id": state.provider_directory.pod_id(),
            });
            json_response(
                StatusCode::OK,
                serde_json::to_string(&body).unwrap_or_default(),
            )
        }
        Err(err) => {
            let body = serde_json::json!({ "error": err });
            json_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                serde_json::to_string(&body).unwrap_or_default(),
            )
        }
    }
}

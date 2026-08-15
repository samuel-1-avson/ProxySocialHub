//! HTTP BN254 Groth16 prover for ProxyHubb batch headers (BC-11-B).
use axum::{
    extract::Json,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use proxyhubb_groth16_prover::{global_prover, PROOF_SYSTEM};
use serde::{Deserialize, Serialize};
use std::{env, net::SocketAddr};

#[derive(Debug, Deserialize)]
struct ProveRequest {
    batch_root: String,
    session_count: u32,
    total_bytes: u64,
    period_start: i64,
    period_end: i64,
    /// SHA256(leaf_0 ‖ … ‖ leaf_n-1) hex (Wave 5.A digest-v2).
    leaves_hash: String,
}

#[derive(Debug, Serialize)]
struct ProveResponse {
    proof_base64: String,
    proof_system: String,
    vk_hash_hex: String,
    public_input_hex: String,
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    ok: bool,
    proof_system: String,
    vk_hash_hex: String,
}

#[derive(Debug, Serialize)]
struct ErrorResponse {
    error: String,
}

fn parse_hash32(hex_str: &str, field: &str) -> Result<[u8; 32], String> {
    let raw = hex_str.trim().trim_start_matches("0x");
    let bytes = hex::decode(raw).map_err(|e| format!("{field} hex: {e}"))?;
    if bytes.len() != 32 {
        return Err(format!("{field} must be 32 bytes, got {}", bytes.len()));
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&bytes);
    Ok(out)
}

async fn health() -> impl IntoResponse {
    let p = global_prover();
    Json(HealthResponse {
        ok: true,
        proof_system: PROOF_SYSTEM.to_string(),
        vk_hash_hex: p.vk_hash_hex(),
    })
}

async fn prove(Json(req): Json<ProveRequest>) -> impl IntoResponse {
    let root = match parse_hash32(&req.batch_root, "batch_root") {
        Ok(r) => r,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse { error: e }),
            )
                .into_response();
        }
    };
    let leaves_hash = match parse_hash32(&req.leaves_hash, "leaves_hash") {
        Ok(h) => h,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse { error: e }),
            )
                .into_response();
        }
    };
    let p = global_prover();
    match p.prove_batch_header(
        root,
        req.session_count,
        req.total_bytes,
        req.period_start,
        req.period_end,
        leaves_hash,
    ) {
        Ok((wire, pub_be)) => (
            StatusCode::OK,
            Json(ProveResponse {
                proof_base64: STANDARD.encode(wire),
                proof_system: PROOF_SYSTEM.to_string(),
                vk_hash_hex: p.vk_hash_hex(),
                public_input_hex: hex::encode(pub_be),
            }),
        )
            .into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse { error: e }),
        )
            .into_response(),
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            env::var("RUST_LOG").unwrap_or_else(|_| "proxyhubb_groth16_prover=info".into()),
        )
        .with_target(false)
        .compact()
        .init();

    let _ = global_prover(); // warm setup
    tracing::info!(vk_hash = %global_prover().vk_hash_hex(), "groth16 keys ready");

    let app = Router::new()
        .route("/healthz", get(health))
        .route("/health", get(health))
        .route("/v1/prove/batch-groth16", post(prove));

    let port: u16 = env::var("PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(8096);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!(%addr, "listening");
    let listener = tokio::net::TcpListener::bind(addr).await.expect("bind");
    axum::serve(listener, app).await.expect("serve");
}

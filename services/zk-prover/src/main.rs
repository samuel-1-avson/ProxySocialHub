use axum::{
    extract::{Json, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use proxyhubb_zk_prover::{
    circuit::{PROOF_SYSTEM, PROVER_K},
    digest::normalize_hex32,
    keys::load_or_create_prover_keys,
    prove::{prove_batch, public_inputs_from_signals, verify_batch, BatchWitness},
    ProverKeys,
};
use serde::{Deserialize, Serialize};
use std::{env, net::SocketAddr, path::PathBuf, sync::Arc};

#[derive(Clone)]
struct AppState {
    keys: Arc<ProverKeys>,
}

#[derive(Debug, Deserialize, Clone)]
struct ProveBatchRequest {
    batch_root: String,
    session_count: u32,
    total_bytes: u64,
    period_start: i64,
    period_end: i64,
    leaf_hashes: Vec<String>,
}

#[derive(Debug, Serialize)]
struct ProveBatchResponse {
    proof_base64: String,
    proof_system: String,
    public_signals: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct VerifyBatchRequest {
    proof_base64: String,
    /// [digest_hex, session_count, total_bytes] (batch_root optional trailing)
    public_signals: Vec<String>,
}

#[derive(Debug, Serialize)]
struct VerifyBatchResponse {
    valid: bool,
    proof_system: String,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    ok: bool,
    mode: String,
    k: u32,
    keys_loaded: bool,
    proof_system: String,
    keys_dir: String,
    params_sha256: String,
    onchain_groth16: bool,
}

#[derive(Debug, Serialize)]
struct ErrorResponse {
    error: String,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            env::var("RUST_LOG")
                .unwrap_or_else(|_| "proxyhubb_zk_prover=info,tower_http=warn".to_string()),
        )
        .with_target(false)
        .compact()
        .init();

    let keys_dir = env::var("ZK_PROVER_KEYS_DIR").unwrap_or_else(|_| {
        if PathBuf::from("/var/lib/proxyhubb-zk").exists()
            || env::var("ZK_PROVER_USE_VAR_LIB").ok().as_deref() == Some("1")
        {
            "/var/lib/proxyhubb-zk".to_string()
        } else {
            "./.zk-keys".to_string()
        }
    });

    let keys = load_or_create_prover_keys(&keys_dir).unwrap_or_else(|e| {
        panic!("failed to load/create prover keys in {keys_dir}: {e}");
    });
    tracing::info!(
        keys_dir = %keys.keys_dir.display(),
        params_sha256 = %keys.params_sha256_hex,
        created_new = keys.created_new_params,
        "Halo2 prover keys ready"
    );

    let state = AppState {
        keys: Arc::new(keys),
    };

    let port = env::var("PORT")
        .ok()
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(8095);

    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/v1/prove/batch", post(prove_batch_handler))
        .route("/v1/verify", post(verify_batch_handler))
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("starting proxyhubb-zk-prover ({PROOF_SYSTEM}) on {addr}");

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("failed to bind TCP listener");

    axum::serve(listener, app)
        .await
        .expect("zk-prover server failed");
}

async fn healthz(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        ok: true,
        mode: "bc11_sprint_a_halo2_stable_keys".to_string(),
        k: PROVER_K,
        keys_loaded: true,
        proof_system: PROOF_SYSTEM.to_string(),
        keys_dir: state.keys.keys_dir.display().to_string(),
        params_sha256: state.keys.params_sha256_hex.clone(),
        onchain_groth16: false,
    })
}

async fn prove_batch_handler(
    State(state): State<AppState>,
    Json(req): Json<ProveBatchRequest>,
) -> impl IntoResponse {
    let witness = match build_witness(&req) {
        Ok(w) => w,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse { error: e }),
            )
                .into_response();
        }
    };

    let keys = state.keys.clone();
    let proving_result = tokio::task::spawn_blocking(move || prove_batch(&keys, &witness)).await;
    let proving_output = match proving_result {
        Ok(Ok(output)) => output,
        Ok(Err(e)) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: format!("proving failed: {e}"),
                }),
            )
                .into_response();
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: format!("proving task join error: {e}"),
                }),
            )
                .into_response();
        }
    };

    let response = ProveBatchResponse {
        proof_base64: STANDARD.encode(&proving_output.proof_bytes),
        proof_system: proving_output.proof_system,
        public_signals: vec![
            proving_output.digest_hex,
            req.session_count.to_string(),
            req.total_bytes.to_string(),
            req.batch_root,
        ],
    };
    (StatusCode::OK, Json(response)).into_response()
}

async fn verify_batch_handler(
    State(state): State<AppState>,
    Json(req): Json<VerifyBatchRequest>,
) -> impl IntoResponse {
    let proof_bytes = match STANDARD.decode(req.proof_base64.trim()) {
        Ok(b) if !b.is_empty() => b,
        Ok(_) => {
            return Json(VerifyBatchResponse {
                valid: false,
                proof_system: PROOF_SYSTEM.to_string(),
                error: Some("empty proof".into()),
            })
            .into_response();
        }
        Err(e) => {
            return Json(VerifyBatchResponse {
                valid: false,
                proof_system: PROOF_SYSTEM.to_string(),
                error: Some(format!("invalid proof_base64: {e}")),
            })
            .into_response();
        }
    };

    if req.public_signals.len() < 3 {
        return Json(VerifyBatchResponse {
            valid: false,
            proof_system: PROOF_SYSTEM.to_string(),
            error: Some(
                "public_signals requires [digest_hex, session_count, total_bytes]".into(),
            ),
        })
        .into_response();
    }

    let digest_hex = req.public_signals[0].trim();
    let session_count: u32 = match req.public_signals[1].parse() {
        Ok(v) => v,
        Err(_) => {
            return Json(VerifyBatchResponse {
                valid: false,
                proof_system: PROOF_SYSTEM.to_string(),
                error: Some("session_count must be u32".into()),
            })
            .into_response();
        }
    };
    let total_bytes: u64 = match req.public_signals[2].parse() {
        Ok(v) => v,
        Err(_) => {
            return Json(VerifyBatchResponse {
                valid: false,
                proof_system: PROOF_SYSTEM.to_string(),
                error: Some("total_bytes must be u64".into()),
            })
            .into_response();
        }
    };

    let public_inputs = match public_inputs_from_signals(digest_hex, session_count, total_bytes) {
        Ok(pi) => pi,
        Err(e) => {
            return Json(VerifyBatchResponse {
                valid: false,
                proof_system: PROOF_SYSTEM.to_string(),
                error: Some(e),
            })
            .into_response();
        }
    };

    let keys = state.keys.clone();
    let result =
        tokio::task::spawn_blocking(move || verify_batch(&keys, &proof_bytes, &public_inputs))
            .await;

    match result {
        Ok(Ok(())) => Json(VerifyBatchResponse {
            valid: true,
            proof_system: PROOF_SYSTEM.to_string(),
            error: None,
        })
        .into_response(),
        Ok(Err(e)) => Json(VerifyBatchResponse {
            valid: false,
            proof_system: PROOF_SYSTEM.to_string(),
            error: Some(e),
        })
        .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("verify task join error: {e}"),
            }),
        )
            .into_response(),
    }
}

fn build_witness(req: &ProveBatchRequest) -> Result<BatchWitness, String> {
    let batch_root = normalize_hex32(&req.batch_root, "batch_root")?;
    let mut leaf_hashes = Vec::with_capacity(req.leaf_hashes.len());
    for (idx, leaf) in req.leaf_hashes.iter().enumerate() {
        leaf_hashes.push(normalize_hex32(leaf, &format!("leaf_hashes[{idx}]"))?);
    }
    Ok(BatchWitness {
        batch_root,
        session_count: req.session_count,
        total_bytes: req.total_bytes,
        period_start: req.period_start,
        period_end: req.period_end,
        leaf_hashes,
    })
}

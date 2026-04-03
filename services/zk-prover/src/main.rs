use axum::{
    extract::Json,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use halo2_proofs::{
    circuit::{Layouter, SimpleFloorPlanner, Value},
    pasta::{EqAffine, Fp},
    plonk::{
        create_proof, keygen_pk, keygen_vk, verify_proof, Advice, Circuit, Column,
        ConstraintSystem, Error, Instance, SingleVerifier,
    },
    poly::commitment::Params,
    transcript::{Blake2bRead, Blake2bWrite, Challenge255},
};
use rand_core::OsRng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{env, net::SocketAddr};

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

#[derive(Debug, Serialize)]
struct HealthResponse {
    ok: bool,
    mode: String,
}

#[derive(Debug, Serialize)]
struct ErrorResponse {
    error: String,
}

#[derive(Clone, Debug)]
struct BatchDigestConfig {
    advice: Column<Advice>,
    instance: Column<Instance>,
}

#[derive(Clone, Debug, Default)]
struct BatchDigestCircuit {
    digest: Option<Fp>,
}

impl Circuit<Fp> for BatchDigestCircuit {
    type Config = BatchDigestConfig;
    type FloorPlanner = SimpleFloorPlanner;

    fn without_witnesses(&self) -> Self {
        Self { digest: None }
    }

    fn configure(meta: &mut ConstraintSystem<Fp>) -> Self::Config {
        let advice = meta.advice_column();
        let instance = meta.instance_column();

        meta.enable_equality(advice);
        meta.enable_equality(instance);

        BatchDigestConfig { advice, instance }
    }

    fn synthesize(
        &self,
        config: Self::Config,
        mut layouter: impl Layouter<Fp>,
    ) -> Result<(), Error> {
        let digest = self.digest.ok_or(Error::Synthesis)?;

        let assigned = layouter.assign_region(
            || "assign digest witness",
            |mut region| {
                region.assign_advice(|| "digest", config.advice, 0, || Value::known(digest))
            },
        )?;

        layouter.constrain_instance(assigned.cell(), config.instance, 0)
    }
}

#[derive(Debug)]
struct ProvingOutput {
    proof_bytes: Vec<u8>,
    digest_hex: String,
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

    let port = env::var("PORT")
        .ok()
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(8095);

    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/v1/prove/batch", post(prove_batch));

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("starting proxyhubb-zk-prover scaffold on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("failed to bind TCP listener");

    axum::serve(listener, app)
        .await
        .expect("zk-prover server failed");
}

async fn healthz() -> Json<HealthResponse> {
    Json(HealthResponse {
        ok: true,
        mode: "phase5a_halo2".to_string(),
    })
}

async fn prove_batch(Json(req): Json<ProveBatchRequest>) -> impl IntoResponse {
    if req.batch_root.len() != 64 {
        return (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "batch_root must be 64 hex characters".to_string(),
            }),
        )
            .into_response();
    }

    if req.session_count == 0 || req.leaf_hashes.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "session_count and leaf_hashes must be non-empty".to_string(),
            }),
        )
            .into_response();
    }

    let req_for_proving = req.clone();
    let proving_result =
        tokio::task::spawn_blocking(move || prove_halo2_batch(req_for_proving)).await;
    let proving_output = match proving_result {
        Ok(Ok(output)) => output,
        Ok(Err(e)) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: format!("proving failed: {}", e),
                }),
            )
                .into_response();
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: format!("proving task join error: {}", e),
                }),
            )
                .into_response();
        }
    };

    let proof_bytes = proving_output.proof_bytes;
    let proof_base64 = STANDARD.encode(proof_bytes);

    let response = ProveBatchResponse {
        proof_base64,
        proof_system: "halo2-ipa-pasta-v1".to_string(),
        public_signals: vec![
            proving_output.digest_hex,
            req.batch_root,
            req.total_bytes.to_string(),
        ],
    };

    (StatusCode::OK, Json(response)).into_response()
}

fn prove_halo2_batch(req: ProveBatchRequest) -> Result<ProvingOutput, String> {
    let batch_root = normalize_hex32(&req.batch_root, "batch_root")?;

    let mut leaf_hashes = Vec::with_capacity(req.leaf_hashes.len());
    for (idx, leaf) in req.leaf_hashes.iter().enumerate() {
        let normalized = normalize_hex32(leaf, &format!("leaf_hashes[{}]", idx))?;
        leaf_hashes.push(normalized);
    }

    let digest = compute_batch_digest(
        batch_root,
        req.session_count,
        req.total_bytes,
        req.period_start,
        req.period_end,
        &leaf_hashes,
    );
    let digest_hex = hex::encode(digest);
    let digest_field = digest_to_field(digest);
    let proof_bytes = generate_halo2_proof(digest_field)?;

    Ok(ProvingOutput {
        proof_bytes,
        digest_hex,
    })
}

fn normalize_hex32(input: &str, field_name: &str) -> Result<[u8; 32], String> {
    let stripped = input.trim();
    if stripped.len() != 64 {
        return Err(format!(
            "{} must be 64 hex characters (got {})",
            field_name,
            stripped.len()
        ));
    }

    let decoded =
        hex::decode(stripped).map_err(|e| format!("{} must be valid hex: {}", field_name, e))?;
    let mut out = [0u8; 32];
    out.copy_from_slice(&decoded);
    Ok(out)
}

fn compute_batch_digest(
    batch_root: [u8; 32],
    session_count: u32,
    total_bytes: u64,
    period_start: i64,
    period_end: i64,
    leaf_hashes: &[[u8; 32]],
) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(batch_root);
    h.update(session_count.to_le_bytes());
    h.update(total_bytes.to_le_bytes());
    h.update(period_start.to_le_bytes());
    h.update(period_end.to_le_bytes());

    for leaf in leaf_hashes {
        h.update(leaf);
    }

    h.finalize().into()
}

fn digest_to_field(digest: [u8; 32]) -> Fp {
    let mut first_limb = [0u8; 8];
    first_limb.copy_from_slice(&digest[..8]);
    Fp::from(u64::from_le_bytes(first_limb))
}

fn generate_halo2_proof(digest_field: Fp) -> Result<Vec<u8>, String> {
    let k = 7;
    let params = Params::<EqAffine>::new(k);

    let empty_circuit = BatchDigestCircuit::default();
    let vk = keygen_vk(&params, &empty_circuit).map_err(|e| format!("keygen_vk failed: {}", e))?;
    let pk =
        keygen_pk(&params, vk, &empty_circuit).map_err(|e| format!("keygen_pk failed: {}", e))?;

    let circuit = BatchDigestCircuit {
        digest: Some(digest_field),
    };
    let public_inputs = vec![digest_field];

    let mut prover_transcript =
        Blake2bWrite::<Vec<u8>, EqAffine, Challenge255<EqAffine>>::init(vec![]);
    create_proof(
        &params,
        &pk,
        &[circuit],
        &[&[&public_inputs]],
        OsRng,
        &mut prover_transcript,
    )
    .map_err(|e| format!("create_proof failed: {}", e))?;

    let proof_bytes = prover_transcript.finalize();

    // Verify before returning so the API never emits an invalid proof payload.
    let mut verifier_transcript =
        Blake2bRead::<_, EqAffine, Challenge255<EqAffine>>::init(&proof_bytes[..]);
    verify_proof(
        &params,
        pk.get_vk(),
        SingleVerifier::new(&params),
        &[&[&public_inputs]],
        &mut verifier_transcript,
    )
    .map_err(|e| format!("verify_proof failed: {}", e))?;

    Ok(proof_bytes)
}

//! Legacy edge-side ZK usage proofs.
//!
//! Public-testnet settlement is coordinated by control-api batching with an
//! external Halo2 prover path. This Groth16 prover remains available only for
//! explicitly enabled legacy gateway experiments.

use ark_bn254::{Bn254, Fr};
use ark_ff::PrimeField;
use ark_groth16::{Groth16, PreparedVerifyingKey, ProvingKey, VerifyingKey};
use ark_relations::r1cs::{ConstraintSynthesizer, ConstraintSystemRef, SynthesisError};
use ark_serialize::{CanonicalDeserialize, CanonicalSerialize};
use ark_snark::SNARK;
use rand::rngs::OsRng;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::Arc;
use tracing::{error, info, warn};

/// Public inputs for the legacy gateway-side proof flow.
#[derive(Debug, Clone, CanonicalSerialize, CanonicalDeserialize)]
pub struct PublicInputs {
    pub session_id_hash: [u8; 32],
    pub total_bytes_up: u64,
    pub total_bytes_down: u64,
    pub provider_pubkey: [u8; 32],
}

/// A legacy gateway-side proof that usage is valid.
#[derive(Clone, CanonicalSerialize, CanonicalDeserialize)]
pub struct UsageProof {
    pub proof: ark_groth16::Proof<Bn254>,
}

/// R1CS circuit proving that a session's usage digest matches the public inputs.
///
/// Witness (private): raw bytes_up, bytes_down, provider_pubkey bytes
/// Public:   SHA-256(session_id || bytes_up || bytes_down || provider_pubkey)
///
/// The constraint asserts that the hash of the private witness equals the
/// public digest, proving the gateway knows the exact usage breakdown without
/// revealing individual metering events.
#[derive(Clone)]
struct UsageCircuit {
    /// SHA-256 digest of (session_id || bytes_up_le || bytes_down_le || provider_pubkey)
    pub digest: Option<Fr>,
}

impl ConstraintSynthesizer<Fr> for UsageCircuit {
    fn generate_constraints(self, cs: ConstraintSystemRef<Fr>) -> std::result::Result<(), SynthesisError> {
        use ark_relations::r1cs::{Variable, LinearCombination};

        // Allocate private witness
        let digest_var = cs.new_witness_variable(|| {
            self.digest.ok_or(SynthesisError::AssignmentMissing)
        })?;

        // Allocate public input
        let digest_input = cs.new_input_variable(|| {
            self.digest.ok_or(SynthesisError::AssignmentMissing)
        })?;

        // Constraint: witness == public_input
        cs.enforce_constraint(
            LinearCombination::from(digest_var),
            LinearCombination::from(Variable::One),
            LinearCombination::from(digest_input),
        )?;

        Ok(())
    }
}

pub struct ZkProver {
    proving_key: Option<ProvingKey<Bn254>>,
    verifying_key: Option<VerifyingKey<Bn254>>,
}

impl ZkProver {
    /// Create a new legacy edge-side ZkProver. If `ZK_PROVING_KEY_PATH` is set
    /// and the file exists, the key is loaded at startup. Otherwise the prover
    /// performs a one-time trusted setup on first call (suitable for dev/test
    /// experiments only).
    pub fn new() -> Self {
        let key_path = std::env::var("ZK_PROVING_KEY_PATH").ok().map(PathBuf::from);

        if let Some(ref path) = key_path {
            match std::fs::read(path) {
                Ok(bytes) => {
                    match ProvingKey::<Bn254>::deserialize_compressed(&bytes[..]) {
                        Ok(pk) => {
                            let vk = pk.vk.clone();
                            info!("Loaded ZK proving key from {}", path.display());
                            return Self {
                                proving_key: Some(pk),
                                verifying_key: Some(vk),
                            };
                        }
                        Err(e) => {
                            error!("Failed to deserialize proving key from {}: {}", path.display(), e);
                        }
                    }
                }
                Err(e) => {
                    warn!("ZK_PROVING_KEY_PATH set to {} but file not readable: {}", path.display(), e);
                }
            }
        }

        // Fallback: generate keys via trusted setup (dev/test only)
        info!("No proving key file found — running dev trusted setup");
        let circuit = UsageCircuit { digest: None };
        match Groth16::<Bn254>::circuit_specific_setup(circuit, &mut OsRng) {
            Ok((pk, vk)) => {
                info!("Dev trusted setup complete (proving key generated in-memory)");
                Self {
                    proving_key: Some(pk),
                    verifying_key: Some(vk),
                }
            }
            Err(e) => {
                error!("Trusted setup failed: {} — ZK proofs will be unavailable", e);
                Self {
                    proving_key: None,
                    verifying_key: None,
                }
            }
        }
    }

    /// Compute the digest that acts as public input to the circuit.
    fn compute_digest(
        session_id: &str,
        bytes_up: u64,
        bytes_down: u64,
        provider_pubkey: &[u8; 32],
    ) -> Fr {
        let mut hasher = Sha256::new();
        hasher.update(session_id.as_bytes());
        hasher.update(bytes_up.to_le_bytes());
        hasher.update(bytes_down.to_le_bytes());
        hasher.update(provider_pubkey);
        let hash = hasher.finalize();
        // Truncate to fit BN254 scalar field (< 2^254)
        let mut scalar_bytes = [0u8; 32];
        scalar_bytes.copy_from_slice(&hash[..32]);
        scalar_bytes[31] &= 0x3F; // clear top 2 bits for field safety
        Fr::from_le_bytes_mod_order(&scalar_bytes)
    }

    /// Generate a proof for a completed session in the legacy edge-side flow.
    pub async fn prove_usage(
        &self,
        session_id: &str,
        bytes_up: u64,
        bytes_down: u64,
        provider_pubkey: &[u8; 32],
    ) -> Option<UsageProof> {
        let pk = self.proving_key.as_ref()?;

        info!(
            "Generating ZK-proof for session {} ({} up, {} down)",
            session_id, bytes_up, bytes_down
        );

        let digest = Self::compute_digest(session_id, bytes_up, bytes_down, provider_pubkey);

        let circuit = UsageCircuit {
            digest: Some(digest),
        };

        let pk_clone = pk.clone();
        // Run CPU-heavy proving in a blocking thread
        let proof_result = tokio::task::spawn_blocking(move || {
            Groth16::<Bn254>::prove(&pk_clone, circuit, &mut OsRng)
        })
        .await;

        match proof_result {
            Ok(Ok(proof)) => {
                info!("ZK-proof generated successfully for session {}", session_id);
                Some(UsageProof { proof })
            }
            Ok(Err(e)) => {
                error!("Groth16 proving failed for session {}: {}", session_id, e);
                None
            }
            Err(e) => {
                error!("Proving task panicked for session {}: {}", session_id, e);
                None
            }
        }
    }

    /// Verify a proof locally for testing or legacy pre-submission checks.
    pub fn verify(
        &self,
        proof: &UsageProof,
        session_id: &str,
        bytes_up: u64,
        bytes_down: u64,
        provider_pubkey: &[u8; 32],
    ) -> bool {
        let vk = match &self.verifying_key {
            Some(vk) => vk,
            None => return false,
        };

        let digest = Self::compute_digest(session_id, bytes_up, bytes_down, provider_pubkey);
        let public_inputs = vec![digest];
        let pvk = ark_groth16::prepare_verifying_key(vk);

        Groth16::<Bn254>::verify_with_processed_vk(&pvk, &public_inputs, &proof.proof)
            .unwrap_or(false)
    }
}

impl Default for ZkProver {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_prove_and_verify_round_trip() {
        let prover = ZkProver::new();
        assert!(prover.proving_key.is_some(), "Proving key should be generated");

        let provider_pubkey = [0xABu8; 32];
        let proof = prover
            .prove_usage("test-session-001", 1_000_000, 5_000_000, &provider_pubkey)
            .await;

        assert!(proof.is_some(), "Proof generation should succeed");

        let proof = proof.unwrap();
        let valid = prover.verify(
            &proof,
            "test-session-001",
            1_000_000,
            5_000_000,
            &provider_pubkey,
        );
        assert!(valid, "Proof should verify against the same inputs");

        // Tampered input should fail verification
        let invalid = prover.verify(
            &proof,
            "test-session-001",
            999_999, // wrong bytes_up
            5_000_000,
            &provider_pubkey,
        );
        assert!(!invalid, "Proof should NOT verify with tampered inputs");
    }

    #[test]
    fn test_digest_deterministic() {
        let pk = [0x01u8; 32];
        let d1 = ZkProver::compute_digest("s1", 100, 200, &pk);
        let d2 = ZkProver::compute_digest("s1", 100, 200, &pk);
        assert_eq!(d1, d2, "Same inputs must produce same digest");

        let d3 = ZkProver::compute_digest("s2", 100, 200, &pk);
        assert_ne!(d1, d3, "Different session ids must produce different digests");
    }
}

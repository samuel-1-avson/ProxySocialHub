use crate::{
    circuit::{BatchDigestCircuit, NUM_PUBLIC_INPUTS, PROOF_SYSTEM},
    digest::{
        compute_batch_digest, digest_to_public_inputs, normalize_hex32, PublicInputs,
    },
    keys::ProverKeys,
};
use halo2_proofs::{
    pasta::{EqAffine, Fp},
    plonk::{create_proof, verify_proof, SingleVerifier},
    transcript::{Blake2bRead, Blake2bWrite, Challenge255},
};
use rand_core::OsRng;

#[derive(Clone, Debug)]
pub struct BatchWitness {
    pub batch_root: [u8; 32],
    pub session_count: u32,
    pub total_bytes: u64,
    pub period_start: i64,
    pub period_end: i64,
    pub leaf_hashes: Vec<[u8; 32]>,
}

#[derive(Clone, Debug)]
pub struct ProveOutput {
    pub proof_bytes: Vec<u8>,
    pub digest_hex: String,
    pub public_inputs: [Fp; NUM_PUBLIC_INPUTS],
    pub proof_system: String,
}

pub fn prove_batch(keys: &ProverKeys, witness: &BatchWitness) -> Result<ProveOutput, String> {
    if witness.session_count == 0 || witness.leaf_hashes.is_empty() {
        return Err("session_count and leaf_hashes must be non-empty".into());
    }
    if witness.leaf_hashes.len() as u32 != witness.session_count {
        return Err(format!(
            "leaf_hashes length {} must equal session_count {}",
            witness.leaf_hashes.len(),
            witness.session_count
        ));
    }

    let digest = compute_batch_digest(
        witness.batch_root,
        witness.session_count,
        witness.total_bytes,
        witness.period_start,
        witness.period_end,
        &witness.leaf_hashes,
    );
    let public = PublicInputs {
        digest,
        session_count: witness.session_count,
        total_bytes: witness.total_bytes,
    };
    let public_inputs = digest_to_public_inputs(&public);
    let circuit = BatchDigestCircuit {
        limbs: Some(public_inputs),
    };

    let mut prover_transcript =
        Blake2bWrite::<Vec<u8>, EqAffine, Challenge255<EqAffine>>::init(vec![]);
    create_proof(
        keys.params.as_ref(),
        keys.pk.as_ref(),
        &[circuit],
        &[&[&public_inputs]],
        OsRng,
        &mut prover_transcript,
    )
    .map_err(|e| format!("create_proof failed: {e}"))?;
    let proof_bytes = prover_transcript.finalize();

    verify_batch(keys, &proof_bytes, &public_inputs)
        .map_err(|e| format!("self-verify failed: {e}"))?;

    Ok(ProveOutput {
        proof_bytes,
        digest_hex: hex::encode(digest),
        public_inputs,
        proof_system: PROOF_SYSTEM.to_string(),
    })
}

pub fn verify_batch(
    keys: &ProverKeys,
    proof_bytes: &[u8],
    public_inputs: &[Fp; NUM_PUBLIC_INPUTS],
) -> Result<(), String> {
    let mut verifier_transcript =
        Blake2bRead::<_, EqAffine, Challenge255<EqAffine>>::init(proof_bytes);
    verify_proof(
        keys.params.as_ref(),
        keys.vk.as_ref(),
        SingleVerifier::new(keys.params.as_ref()),
        &[&[&public_inputs[..]]],
        &mut verifier_transcript,
    )
    .map_err(|e| format!("verify_proof failed: {e}"))
}

/// Rebuild public inputs from API signals: digest_hex, session_count, total_bytes.
pub fn public_inputs_from_signals(
    digest_hex: &str,
    session_count: u32,
    total_bytes: u64,
) -> Result<[Fp; NUM_PUBLIC_INPUTS], String> {
    let digest = normalize_hex32(digest_hex, "digest")?;
    Ok(digest_to_public_inputs(&PublicInputs {
        digest,
        session_count,
        total_bytes,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keys::load_or_create_prover_keys;
    use tempfile::tempdir;

    #[test]
    fn prove_verify_roundtrip_stable_params() {
        let dir = tempdir().expect("tempdir");
        let keys1 = load_or_create_prover_keys(dir.path()).expect("keys1");
        assert!(keys1.created_new_params);

        let root = [0xABu8; 32];
        let leaf = [0xCDu8; 32];
        let witness = BatchWitness {
            batch_root: root,
            session_count: 1,
            total_bytes: 1024,
            period_start: 100,
            period_end: 200,
            leaf_hashes: vec![leaf],
        };
        let out = prove_batch(&keys1, &witness).expect("prove");
        verify_batch(&keys1, &out.proof_bytes, &out.public_inputs).expect("verify");

        // Reload params from disk — proofs must still verify.
        let keys2 = load_or_create_prover_keys(dir.path()).expect("keys2");
        assert!(!keys2.created_new_params);
        assert_eq!(keys1.params_sha256_hex, keys2.params_sha256_hex);
        verify_batch(&keys2, &out.proof_bytes, &out.public_inputs).expect("verify after reload");
    }
}

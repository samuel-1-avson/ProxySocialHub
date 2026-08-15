//! BN254 Groth16 batch-header prover (BC-11-B / Wave 5.A digest-v2).
//! Circuit matches on-chain `groth16_batch` / tools/gen-batch-vk:
//! public Fr == private Fr where
//! Fr = SHA256(root‖count‖bytes‖window‖leaves_hash) mod r.
use ark_bn254::{Bn254, Fr, G1Affine, G2Affine};
use ark_ff::{BigInteger, PrimeField};
use ark_groth16::{Groth16, Proof, ProvingKey, VerifyingKey};
use ark_relations::r1cs::{ConstraintSynthesizer, ConstraintSystemRef, SynthesisError};
use ark_serialize::{CanonicalSerialize, Compress};
use ark_snark::SNARK;
use ark_std::rand::rngs::StdRng;
use ark_std::rand::SeedableRng;
use sha2::{Digest, Sha256};
use std::ops::Neg;
use std::sync::OnceLock;

/// Must match tools/gen-batch-vk and embedded program VK.
pub const SETUP_SEED: u64 = 0x5052_4F58_5948_5542;
pub const PROOF_WIRE_LEN: usize = 256;
pub const PROOF_SYSTEM: &str = "groth16-bn254-batch-digest-v2";

#[derive(Clone)]
struct BatchDigestCircuit {
    digest: Option<Fr>,
}

impl ConstraintSynthesizer<Fr> for BatchDigestCircuit {
    fn generate_constraints(self, cs: ConstraintSystemRef<Fr>) -> Result<(), SynthesisError> {
        use ark_relations::r1cs::{LinearCombination, Variable};
        let w = cs.new_witness_variable(|| self.digest.ok_or(SynthesisError::AssignmentMissing))?;
        let p = cs.new_input_variable(|| self.digest.ok_or(SynthesisError::AssignmentMissing))?;
        cs.enforce_constraint(
            LinearCombination::from(w),
            LinearCombination::from(Variable::One),
            LinearCombination::from(p),
        )?;
        Ok(())
    }
}

fn rev32(chunk: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    for (i, b) in chunk.iter().take(32).enumerate() {
        out[31 - i] = *b;
    }
    out
}

fn g1_uncompressed_be(p: &G1Affine) -> [u8; 64] {
    let mut le = Vec::new();
    p.serialize_with_mode(&mut le, Compress::No).unwrap();
    let mut out = [0u8; 64];
    out[..32].copy_from_slice(&rev32(&le[..32]));
    out[32..].copy_from_slice(&rev32(&le[32..64]));
    out
}

fn g2_uncompressed_be(p: &G2Affine) -> [u8; 128] {
    let mut le = Vec::new();
    p.serialize_with_mode(&mut le, Compress::No).unwrap();
    let mut out = [0u8; 128];
    out[..32].copy_from_slice(&rev32(&le[32..64]));
    out[32..64].copy_from_slice(&rev32(&le[..32]));
    out[64..96].copy_from_slice(&rev32(&le[96..128]));
    out[96..].copy_from_slice(&rev32(&le[64..96]));
    out
}

fn fr_to_be(f: &Fr) -> [u8; 32] {
    let le = f.into_bigint().to_bytes_le();
    let mut be = [0u8; 32];
    for (i, b) in le.iter().take(32).enumerate() {
        be[31 - i] = *b;
    }
    be
}

/// Header digest Fr matching on-chain `batch_digest_public_input` (digest-v2).
pub fn hash_batch_digest(
    root: [u8; 32],
    session_count: u32,
    total_bytes: u64,
    period_start: i64,
    period_end: i64,
    leaves_hash: [u8; 32],
) -> Fr {
    let mut h = Sha256::new();
    h.update(root);
    h.update(session_count.to_le_bytes());
    h.update(total_bytes.to_le_bytes());
    h.update(period_start.to_le_bytes());
    h.update(period_end.to_le_bytes());
    h.update(leaves_hash);
    Fr::from_le_bytes_mod_order(&h.finalize())
}

pub struct ProverState {
    pk: ProvingKey<Bn254>,
    vk_hash: [u8; 32],
}

fn vk_hash_of(vk: &VerifyingKey<Bn254>) -> [u8; 32] {
    let alpha = g1_uncompressed_be(&vk.alpha_g1);
    let beta = g2_uncompressed_be(&vk.beta_g2);
    let gamma = g2_uncompressed_be(&vk.gamma_g2);
    let delta = g2_uncompressed_be(&vk.delta_g2);
    let ic: Vec<[u8; 64]> = vk.gamma_abc_g1.iter().map(g1_uncompressed_be).collect();
    let mut input = Vec::new();
    for part in [&alpha[..], &beta[..], &gamma[..], &delta[..], &ic[0][..], &ic[1][..]] {
        input.extend_from_slice(part);
    }
    Sha256::digest(&input).into()
}

impl ProverState {
    pub fn setup() -> Self {
        let mut rng = StdRng::seed_from_u64(SETUP_SEED);
        let (pk, vk): (ProvingKey<Bn254>, VerifyingKey<Bn254>) =
            Groth16::<Bn254>::circuit_specific_setup(BatchDigestCircuit { digest: None }, &mut rng)
                .expect("groth16 setup");
        let vk_hash = vk_hash_of(&vk);
        Self { pk, vk_hash }
    }

    pub fn vk_hash_hex(&self) -> String {
        hex::encode(self.vk_hash)
    }

    pub fn expected_vk_hash(&self) -> [u8; 32] {
        self.vk_hash
    }

    /// Prove and return wire proof A(64)||B(128)||C(64) with A pre-negated (BE).
    pub fn prove_batch_header(
        &self,
        root: [u8; 32],
        session_count: u32,
        total_bytes: u64,
        period_start: i64,
        period_end: i64,
        leaves_hash: [u8; 32],
    ) -> Result<([u8; PROOF_WIRE_LEN], [u8; 32]), String> {
        if session_count == 0 || total_bytes == 0 {
            return Err("session_count and total_bytes must be > 0".into());
        }
        if root == [0u8; 32] {
            return Err("batch_root must be non-zero".into());
        }
        if leaves_hash == [0u8; 32] {
            return Err("leaves_hash must be non-zero".into());
        }
        let digest = hash_batch_digest(
            root,
            session_count,
            total_bytes,
            period_start,
            period_end,
            leaves_hash,
        );
        // Fresh-enough RNG from header binding (no getrandom / rand crate).
        let mut seed = [0u8; 32];
        {
            let mut h = Sha256::new();
            h.update(b"proxyhubb-groth16-prove-rng");
            h.update(root);
            h.update(session_count.to_le_bytes());
            h.update(total_bytes.to_le_bytes());
            h.update(period_start.to_le_bytes());
            h.update(period_end.to_le_bytes());
            h.update(leaves_hash);
            h.update(std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
                .to_le_bytes());
            seed.copy_from_slice(&h.finalize());
        }
        let mut rng = StdRng::from_seed(seed);
        let proof: Proof<Bn254> = Groth16::<Bn254>::prove(
            &self.pk,
            BatchDigestCircuit {
                digest: Some(digest),
            },
            &mut rng,
        )
        .map_err(|e| format!("prove: {e}"))?;

        let a = g1_uncompressed_be(&proof.a.neg());
        let b = g2_uncompressed_be(&proof.b);
        let c = g1_uncompressed_be(&proof.c);
        let mut wire = [0u8; PROOF_WIRE_LEN];
        wire[..64].copy_from_slice(&a);
        wire[64..192].copy_from_slice(&b);
        wire[192..256].copy_from_slice(&c);
        Ok((wire, fr_to_be(&digest)))
    }
}

static GLOBAL: OnceLock<ProverState> = OnceLock::new();

pub fn global_prover() -> &'static ProverState {
    GLOBAL.get_or_init(ProverState::setup)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sample_header_proves_and_matches_digest() {
        let p = ProverState::setup();
        let root = [0x11u8; 32];
        let leaves = [0x22u8; 32];
        let (wire, pub_be) = p
            .prove_batch_header(root, 3, 1000, 1, 2, leaves)
            .expect("prove");
        assert_eq!(wire.len(), 256);
        let expect = fr_to_be(&hash_batch_digest(root, 3, 1000, 1, 2, leaves));
        assert_eq!(pub_be, expect);
        // VK hash must match program BatchGroth16VKHashHex
        assert_eq!(
            p.vk_hash_hex(),
            "2f1075c22786a7763bfaee9ec39188b2aec7fb19de0aa1c3aac9e7ce29519e72"
        );
    }
}

//! BC-11-B / Wave 5.A: on-chain Groth16 batch verify (feature `onchain-groth16`).
//!
//! Digest-v2 public input = Fr(SHA256(root ‖ session_count_le ‖ total_bytes_le ‖
//! period_start_le ‖ period_end_le ‖ leaves_hash)) in big-endian field encoding.
#![cfg(feature = "onchain-groth16")]

use crate::groth16_vk_generated::{
    VK_ALPHA_G1, VK_BETA_G2, VK_DELTA_G2, VK_GAMMA_G2, VK_HASH, VK_IC0, VK_IC1,
};
use groth16_solana::groth16::{Groth16Verifier, Groth16Verifyingkey};
use num_bigint::BigUint;
use solana_program::hash::hashv;

/// BN254 scalar-field modulus (r) big-endian.
const FR_MODULUS_BE: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58,
    0x5d, 0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00,
    0x00, 0x01,
];

pub const PROOF_LEN: usize = 256; // A(64) || B(128) || C(64)

pub fn expected_vk_hash() -> [u8; 32] {
    VK_HASH
}

/// SHA256 → Fr (LE bytes mod r) → 32-byte big-endian public input (digest-v2).
pub fn batch_digest_public_input(
    root: &[u8; 32],
    session_count: u32,
    total_bytes: u64,
    period_start: i64,
    period_end: i64,
    leaves_hash: &[u8; 32],
) -> [u8; 32] {
    let sc = session_count.to_le_bytes();
    let tb = total_bytes.to_le_bytes();
    let ps = period_start.to_le_bytes();
    let pe = period_end.to_le_bytes();
    let digest = hashv(&[
        root.as_slice(),
        &sc,
        &tb,
        &ps,
        &pe,
        leaves_hash.as_slice(),
    ])
    .to_bytes();
    fr_le_hash_to_be(&digest)
}

fn fr_le_hash_to_be(le_hash: &[u8; 32]) -> [u8; 32] {
    let n = BigUint::from_bytes_le(le_hash);
    let r = BigUint::from_bytes_be(&FR_MODULUS_BE);
    let reduced = n % r;
    let bytes = reduced.to_bytes_be();
    let mut out = [0u8; 32];
    out[32 - bytes.len()..].copy_from_slice(&bytes);
    out
}

pub fn verifying_key() -> Groth16Verifyingkey<'static> {
    static IC: [[u8; 64]; 2] = [VK_IC0, VK_IC1];
    Groth16Verifyingkey {
        nr_pubinputs: 1,
        vk_alpha_g1: VK_ALPHA_G1,
        vk_beta_g2: VK_BETA_G2,
        vk_gamme_g2: VK_GAMMA_G2,
        vk_delta_g2: VK_DELTA_G2,
        vk_ic: &IC[..],
    }
}

/// Verify a 256-byte BE proof (A pre-negated) against the batch public input.
pub fn verify_batch_proof(proof_bytes: &[u8], public_input: &[u8; 32]) -> Result<(), ()> {
    if proof_bytes.len() != PROOF_LEN {
        return Err(());
    }
    let proof_a: [u8; 64] = proof_bytes[0..64].try_into().map_err(|_| ())?;
    let proof_b: [u8; 128] = proof_bytes[64..192].try_into().map_err(|_| ())?;
    let proof_c: [u8; 64] = proof_bytes[192..256].try_into().map_err(|_| ())?;
    let public_inputs = [*public_input];
    let vk = verifying_key();
    let mut verifier = Groth16Verifier::new(&proof_a, &proof_b, &proof_c, &public_inputs, &vk)
        .map_err(|_| ())?;
    verifier.verify().map_err(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::groth16_vk_generated::{
        SAMPLE_BATCH_ROOT, SAMPLE_LEAVES_HASH, SAMPLE_PROOF_A, SAMPLE_PROOF_B, SAMPLE_PROOF_C,
        SAMPLE_PUBLIC_INPUT,
    };

    #[test]
    fn sample_proof_verifies() {
        let mut proof = [0u8; PROOF_LEN];
        proof[..64].copy_from_slice(&SAMPLE_PROOF_A);
        proof[64..192].copy_from_slice(&SAMPLE_PROOF_B);
        proof[192..256].copy_from_slice(&SAMPLE_PROOF_C);
        verify_batch_proof(&proof, &SAMPLE_PUBLIC_INPUT).expect("sample verify");
    }

    #[test]
    fn digest_matches_sample() {
        let got = batch_digest_public_input(&SAMPLE_BATCH_ROOT, 3, 1000, 1, 2, &SAMPLE_LEAVES_HASH);
        assert_eq!(got, SAMPLE_PUBLIC_INPUT);
    }
}

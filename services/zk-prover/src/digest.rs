use crate::circuit::NUM_PUBLIC_INPUTS;
use halo2_proofs::pasta::Fp;
use sha2::{Digest, Sha256};

#[derive(Clone, Debug)]
pub struct PublicInputs {
    pub digest: [u8; 32],
    pub session_count: u32,
    pub total_bytes: u64,
}

pub fn normalize_hex32(input: &str, field_name: &str) -> Result<[u8; 32], String> {
    let stripped = input.trim();
    if stripped.len() != 64 {
        return Err(format!(
            "{field_name} must be 64 hex characters (got {})",
            stripped.len()
        ));
    }
    let decoded =
        hex::decode(stripped).map_err(|e| format!("{field_name} must be valid hex: {e}"))?;
    let mut out = [0u8; 32];
    out.copy_from_slice(&decoded);
    Ok(out)
}

pub fn compute_batch_digest(
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

/// Pack full 32-byte digest as four u64 LE limbs plus session_count and total_bytes.
pub fn digest_to_public_inputs(inputs: &PublicInputs) -> [Fp; NUM_PUBLIC_INPUTS] {
    let d = &inputs.digest;
    let limb = |offset: usize| {
        let mut buf = [0u8; 8];
        buf.copy_from_slice(&d[offset..offset + 8]);
        Fp::from(u64::from_le_bytes(buf))
    };
    [
        limb(0),
        limb(8),
        limb(16),
        limb(24),
        Fp::from(u64::from(inputs.session_count)),
        Fp::from(inputs.total_bytes),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn digest_binds_leaves() {
        let root = [1u8; 32];
        let leaf_a = [2u8; 32];
        let leaf_b = [3u8; 32];
        let d1 = compute_batch_digest(root, 2, 100, 1, 2, &[leaf_a, leaf_b]);
        let d2 = compute_batch_digest(root, 2, 100, 1, 2, &[leaf_a, leaf_a]);
        assert_ne!(d1, d2);
    }

    #[test]
    fn public_inputs_use_full_digest() {
        let mut digest = [0u8; 32];
        digest[0] = 1;
        digest[8] = 2;
        digest[16] = 3;
        digest[24] = 4;
        let pi = digest_to_public_inputs(&PublicInputs {
            digest,
            session_count: 9,
            total_bytes: 42,
        });
        assert_eq!(pi[0], Fp::from(1u64));
        assert_eq!(pi[1], Fp::from(2u64));
        assert_eq!(pi[2], Fp::from(3u64));
        assert_eq!(pi[3], Fp::from(4u64));
        assert_eq!(pi[4], Fp::from(9u64));
        assert_eq!(pi[5], Fp::from(42u64));
    }
}

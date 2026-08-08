//! ProxyHubb ZK prover library (BC-11 Sprint A).
//!
//! Off-chain Halo2-IPA (pasta) proofs over a Merkle-batch digest.
//! On-chain Solana cannot verify this proof system — Sprint B targets BN254 Groth16.
//! Stable SRS (`params.bin`) makes prove/verify reproducible across restarts.

pub mod circuit;
pub mod digest;
pub mod keys;
pub mod prove;

pub use circuit::{BatchDigestCircuit, NUM_PUBLIC_INPUTS, PROOF_SYSTEM, PROVER_K};
pub use digest::{compute_batch_digest, digest_to_public_inputs, normalize_hex32, PublicInputs};
pub use keys::{load_or_create_prover_keys, ProverKeys};
pub use prove::{prove_batch, public_inputs_from_signals, verify_batch, BatchWitness, ProveOutput};

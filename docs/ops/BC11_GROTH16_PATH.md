# BC-11 Groth16 on-chain path (Sprint B target)

## Why not Halo2-IPA on Solana

The Sprint A zk-prover uses **Halo2-IPA over the pasta/Pallas curve**. Solana’s
`alt_bn128` syscalls verify **BN254** pairings (Groth16 / PLONK-BN254), not pasta IPA.
Pasta Halo2 proofs therefore remain **off-chain only** (`POST /v1/prove/batch` +
`POST /v1/verify`). On-chain today: oracle Ed25519 over Merkle `batch_root` +
`proof_hash = SHA256(proof_bytes)`.

## Sprint B target architecture

1. Rebuild batch circuit in **BN254** (circom or arkworks Groth16).
2. Emit Groth16 proof + VK; store VK hash on-chain or in program config.
3. Add `submit_zk_batch_groth16` (or gate existing ix behind
   `PROXYHUB_ZK_ONCHAIN_GROTH16=true`) that:
   - verifies Groth16 via `alt_bn128` / light-protocol style verifier accounts
   - then writes `ZKBatchPDA` (same seeds)
4. Reputation program updates scores only after verified batch PDA exists.

## Feature flag

| Env | Default | Meaning |
|-----|---------|---------|
| `PROXYHUB_ZK_ONCHAIN_GROTH16` | `false` | When true (future), control-api / program expect BN254 proof accounts |

Do **not** enable in production until Sprint B verifier + Anchor tests pass.

## Sprint A honesty statement

Settlement language: **oracle-attested Merkle batch anchor** with optional
off-chain Halo2 blob verified by zk-prover `/v1/verify`. Not trustless ZK.

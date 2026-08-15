# Evidence: BC-11-B real Groth16 on-chain verify (2026-08-11)

## Scope

Complete BC-11-B: replace fail-closed stub with BN254 Groth16 verify via
`groth16-solana` / `alt_bn128`, then init `ZKBatchPDA`.

## What shipped

1. **Host VK + sample proof** — `tools/gen-batch-vk` (arkworks setup +
   groth16-solana host verify OK). Emits
   `programs/proxyhub/src/groth16_vk_generated.rs`.
2. **Program** — `groth16_batch.rs` + `submit_zk_batch_groth16` verifies proof,
   checks `vk_hash`, writes PDA when `--features onchain-groth16`.
3. **Control-api** — `PROXYHUB_ZK_ONCHAIN_GROTH16_READY` gates
   `ZKOnchainGroth16Ready()`; `SubmitZKBatchGroth16` builds/sends tx when ready.
4. **Docs** — `docs/ops/BC11_GROTH16_PATH.md` updated.

## Host proof

```
cargo test -p proxyhub --features onchain-groth16 groth16
# digest_matches_sample ... ok
# sample_proof_verifies ... ok
```

```
cd tools/gen-batch-vk && cargo run --release
# host verify: OK
# vk_hash=2f1075c22786a7763bfaee9ec39188b2aec7fb19de0aa1c3aac9e7ce29519e72
```

```
cargo-build-sbf --features onchain-groth16   # exit 0 (2026-08-11)
# → target/deploy/proxyhub.so
```

## Not done (ops)

- [ ] Redeploy proxyhub.so (onchain-groth16) on devnet
- [ ] Set `PROXYHUB_ZK_ONCHAIN_GROTH16_READY=true` on testnet only after deploy
- [ ] End-to-end live tx with proof account + sample inputs
- [ ] Do **not** enable on mainnet / claim trustless metering

## Circuit note

Public input binds batch header hash only (root, count, bytes, window) — not
Halo2 leaf hashes. Extend later if full leaf binding is required on-chain.

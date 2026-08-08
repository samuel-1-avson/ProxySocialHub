# Reputation program (BC-11)

**Status:** Sprint A rebuild — **not deployable**.

- Placeholder `declare_id!`: `Repu111111111111111111111111111111111111111`
- `verify_usage` requires oracle signer + non-zero `batch_root` + non-zero `proof_hash`
- Does **not** verify Halo2 or Groth16 on-chain (see `docs/ops/BC11_GROTH16_PATH.md`)

Build check (requires Anchor toolchain):

```bash
cd programs/reputation
cargo check
```

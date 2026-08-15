# Reputation program (BC-11 / Wave 4.2)

**Status:** Real **devnet** program ID wired — deploy when ready; mutations gated by `deploy_allowed`.

| Field | Value |
|-------|-------|
| Program ID | `EnVE6ehKA2dYi69B3Lo8wt2wyDgzLw4tdtSEKoMYe5bF` |
| Keypair | `target/deploy/proxy_reputation-keypair.json` (**gitignored**) |
| Proxyhub (ZKBatchPDA owner) | `AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu` |

## Behavior

- `verify_usage` requires oracle signer + non-zero `batch_root` + non-zero `proof_hash`
- Default build: oracle-attested score updates
- Cargo feature `onchain-groth16`: `remaining_accounts[0]` must be a live proxyhub `ZKBatchPDA` whose stored root matches (scores only after verified/anchored batch PDA)
- Admin must `set_deploy_allowed(true)` after `initialize_config` before provider/score mutations

## Build / deploy

```powershell
cd programs/reputation
cargo check
# With SBF toolchain:
# cargo build-sbf
..\..\scripts\deploy-reputation-devnet.ps1
```

Env: `REPUTATION_PROGRAM_ID=EnVE6ehKA2dYi69B3Lo8wt2wyDgzLw4tdtSEKoMYe5bF`

See `docs/ops/BC11_REPUTATION_DEPLOY.md` and evidence `W4_2_reputation_program_id_20260811.md`.

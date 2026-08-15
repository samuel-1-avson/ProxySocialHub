# W4.2 — BC-11-C reputation program ID + deploy path

| Field | Value |
|-------|-------|
| Date | 2026-08-11 |
| Result | `BC11_REPUTATION_REAL_ID` |
| Program ID | `EnVE6ehKA2dYi69B3Lo8wt2wyDgzLw4tdtSEKoMYe5bF` |
| Spec | [BC11_REPUTATION_DEPLOY.md](../BC11_REPUTATION_DEPLOY.md) |

## What landed

1. Replaced placeholder `Repu1111…` with generated devnet program ID.
2. Keypair at `programs/reputation/target/deploy/proxy_reputation-keypair.json` (gitignored).
3. `deploy_allowed` gate + `set_deploy_allowed`; mutating ixs refuse until enabled.
4. Cargo `onchain-groth16`: `verify_usage` requires proxyhub `ZKBatchPDA` root match.
5. Control-api: `REPUTATION_PROGRAM_ID`, `VerifyUsage` client, score gate via Groth16 fail-closed.
6. Compose no longer aliases reputation ID to proxyhub.
7. Deploy script: `scripts/deploy-reputation-devnet.ps1`.

## Not yet done (ops)

- [x] `initialize_config` + `set_deploy_allowed(true)` (see `W4_2_reputation_init_deploy_allowed_20260811.md`)
- [x] Record on-chain dump SHA256 after deploy (`8f55c5fb…fd92`)

## Non-claims

- Program may not be live on cluster until deploy script is run
- Groth16 verify still not ready (W4.1)
- No mainnet deploy

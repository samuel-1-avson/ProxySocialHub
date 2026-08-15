# BC-11-C — Reputation program deploy path (Wave 4.2)

## Program ID

| Cluster | Program ID | Status |
|---------|------------|--------|
| Devnet (target) | `EnVE6ehKA2dYi69B3Lo8wt2wyDgzLw4tdtSEKoMYe5bF` | Keypair generated; deploy via script |
| Mainnet | — | **Not authorized** |

Keypair path (gitignored): `programs/reputation/target/deploy/proxy_reputation-keypair.json`

## Env

```bash
REPUTATION_PROGRAM_ID=EnVE6ehKA2dYi69B3Lo8wt2wyDgzLw4tdtSEKoMYe5bF
# Must NOT equal SOLANA_PROGRAM_ID (proxyhub escrow).
SOLANA_PROGRAM_ID=AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu
```

## Score update rules

| Build / flag | Score update allowed when |
|--------------|---------------------------|
| Default (no `onchain-groth16`) | Oracle signed `verify_usage` + non-zero root/proof_hash + `deploy_allowed` |
| Cargo `onchain-groth16` | Above **and** remaining_accounts[0] is proxyhub `ZKBatchPDA` with matching root |
| `PROXYHUB_ZK_ONCHAIN_GROTH16=true` (control-api) | Settlement fail-closed until `ZKOnchainGroth16Ready()`; do not credit scores via oracle-only path |

## Consume path (control-api)

After `ZKAggregator` settles a batch it:

1. Aggregates `UsageProof` bytes by `provider_wallet`
2. `EnsureProviderReputation` → `initialize_provider_for` if PDA missing
3. `VerifyUsage` with derived `ZKBatchPDA` when Groth16 ready

Evidence: [`evidence/W4_2_reputation_consume_registry_enforce_20260811.md`](evidence/W4_2_reputation_consume_registry_enforce_20260811.md)

## Deploy steps

1. `$env:CARGO_TARGET_DIR = (Resolve-Path programs/reputation/target)` then `cargo-build-sbf` from `programs/reputation`
2. `scripts/deploy-reputation-devnet.ps1` (or `solana program deploy --url devnet --program-id … proxy_reputation.so`)
3. `initialize_config` + `set_deploy_allowed(true)`
4. Point compose/env at `REPUTATION_PROGRAM_ID`

**Live (2026-08-11):** program deployed — see `evidence/W4_2_reputation_devnet_deploy_20260811.md`.

## Honesty

Placeholder `Repu1111…` is **removed**. Until the program is actually deployed and `deploy_allowed` is true, control-api reports `reputation_program` as configured-but-not-live.

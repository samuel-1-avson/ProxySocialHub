# Evidence: reputation ZKBatchPDA consume + registry gate enforce (2026-08-11)

## Verdict

**PASS (ops smoke)** — control-api credits providers via `VerifyUsage` after ZK batch settle
(passing proxyhub `ZKBatchPDA` when Groth16 ready). Registry gate on gcp-testnet /
live VM is **`enforce`**. Live image rebuilt with Finalized PDA wait.

## Reputation consume

| Piece | Status |
|-------|--------|
| On-chain `verify_usage` + remaining_accounts ZKBatchPDA | Existing under `onchain-groth16` |
| New `initialize_provider_for` (oracle-paid PDA init) | Added |
| Go `EnsureProviderReputation` / `CreditProvidersFromZKBatch` | Added |
| `ZKAggregator.creditReputationAfterSettle` after settle | Wired |
| Deploy script builds with `--features onchain-groth16` | Updated |

Flow: `SubmitZKBatchGroth16` → derive PDA → per-provider `EnsureProviderReputation` →
`VerifyUsage(batch_root, proof_hash, bytes, ZKBatchPDA)`.

## Registry gate enforce

| Surface | Behavior |
|---------|----------|
| Session activation | Fail-closed when inactive/stale/no hotkey |
| Smart-match | Filters inactive |
| Browse / map | Honesty annotations only (intentional) |

`docker-compose.gcp-testnet.yml` default:
`PROXYHUB_PROVIDER_REGISTRY_GATE=enforce`

## Ops cutover (testnet)

```bash
# 1) Upgrade reputation program (devnet) — DONE 2026-08-11
#    sig 4bzqFRPiWVhYJzf6um3YxWKRz6FEqpJGUaNfYUu2d7b3pYgVJ4bWnsj2j3q32exFVRGHTG6xQsUNGVZMjJsjTH87
#    .so SHA256 EEE1144399C0D17259716664114C014F4A932A6429EA18189C98C42549272AF8
#    data length 277704 (was 258160)
# 2) On VM .env:
PROXYHUB_PROVIDER_REGISTRY_GATE=enforce   # DONE — printenv=enforce
# 3) Rebuild/recreate control-api with aggregator credit path
# 4) Smoke: settle a signed usage batch → reputation score moves; inactive hotkey blocked on activate
```

### Live confirmations (2026-08-11)

| Item | Result |
|------|--------|
| Reputation upgrade (onchain-groth16 + initialize_provider_for) | sig `4bzqFRPi…TH87`, slot `482962886` |
| Registry gate on proxyhubb-testnet | `PROXYHUB_PROVIDER_REGISTRY_GATE=enforce` |
| Control-api image | Rebuilt with `CreditProvidersFromZKBatch` + **Finalized** ZKBatchPDA wait (fixes InvalidZkBatchOwner 6007 race) |
| Settle → verify_usage → score | **PASS** (local oracle `8P4uuapg…`, prover `:18096`) |
| Registry enforce smoke | **PASS** — empty / invalid / unregistered hotkey → `ErrProviderRegistryInactive` |

#### Reputation credit e2e (Finalized wait)

| Field | Value |
|-------|--------|
| Settle sig | `xhyeKazHgQuarpZT5MfgYhCdkZhy2BT17n5xEcjrNH8FxFgHoVnTEhcjEfzHhnpzvNucprUGgAmbyX8HQgm21qS` |
| Batch PDA | `DTHj22iJVxA5G3zqAiybNApbQRRZmzNE5K7gs3BVMciq` (proxyhub-owned) |
| Credit sig | `5x1RhRiFtV1NWFvbpRNwK4RfeNd8vrtxUeCxFATkSQJ2PiyW12AQijGbb3nEMKJM1sGpVatiCKFx8k4KbJV8qjLc` |
| Score | `102 → 103` |
| Earlier credit (same day) | sig `3AJKBkYT…jZmd`, on-chain log `score=101`, root match OK |

**Root cause of 6007:** Confirmed RPC saw the PDA, but `SendTransaction` preflight still treated it as system-owned until **Finalized**. `waitForProxyhubAccount` now waits on Finalized.

## Non-claims

- Browse catalog is not hard-filtered by registry gate
- Metering still not fully trustless
- Mainnet not claimed

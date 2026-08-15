# W4.1 — BC-11-B Groth16 on-chain path (fail-closed stub)

| Field | Value |
|-------|-------|
| Date | 2026-08-11 |
| Result | `BC11_GROTH16_FAIL_CLOSED_STUB` |
| Plan | [WAVE4_DECENTRALIZATION_PLAN.md](../WAVE4_DECENTRALIZATION_PLAN.md) |
| Spec | [BC11_GROTH16_PATH.md](../BC11_GROTH16_PATH.md) |

## What landed

1. Program ix `submit_zk_batch_groth16` — always errors; never writes `ZKBatchPDA`.
2. Cargo feature `onchain-groth16` on proxyhub (+ reputation refuse-oracle-only when enabled).
3. Control-api: `GateOnchainGroth16Settlement`, `ZKOnchainGroth16Ready()=false`, `SubmitZKBatchGroth16` client encode + refuse.
4. Aggregator: flag on → Groth16 path only (fail-closed), not oracle `submit_zk_batch`.
5. Honesty meta on public system config + reputation telemetry.
6. `.env.example` / compose already carry `PROXYHUB_ZK_ONCHAIN_GROTH16=false`.

## Non-claims

- No alt_bn128 verify yet
- Enabling the env flag does **not** enable trustless ZK; it stops settlement
- Reputation program still placeholder ID (W4.2)
- Halo2-IPA remains the off-chain proof system

## Tests

```text
go test ./internal/decentralization/ ./internal/solana/ -count=1 -run 'ZKOnchainGroth16|SubmitZKBatchGroth16|EncodeSubmitZKBatch'
```

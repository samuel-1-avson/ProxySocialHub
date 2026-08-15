# Evidence: BN254 Groth16 prover → aggregator wiring (2026-08-11)

## Scope

Wire a host BN254 Groth16 prover (matching on-chain batch-header circuit) into
control-api `ZKAggregator` so `PROXYHUB_ZK_ONCHAIN_GROTH16=true` can submit
real proofs via `SubmitZKBatchGroth16`.

## What shipped

1. **Service** `services/groth16-prover`
   - Same setup seed / circuit as `tools/gen-batch-vk`
   - `POST /v1/prove/batch-groth16` → 256-byte wire proof + `vk_hash_hex`
   - Compose profile: `docker compose --profile groth16 up -d groth16-prover`
2. **Go client** `internal/zk/groth16_client.go` (`GROTH16_PROVER_URL`)
3. **Aggregator** attaches Groth16 proof when require lane / `GROTH16_PROVER_REQUIRED`;
   passes `Proof` into `SubmitZKBatchGroth16` (fixes empty-proof bug)

## Tests (2026-08-11)

```
cd services/groth16-prover && cargo test -j 1 --lib
# → ok: sample_header_proves_and_matches_digest

cd services/control-api && go test ./internal/zk/ ./internal/billing/ -count=1
# → ok
```

Note: on Windows, `cargo test` can crash under high parallelism (`STATUS_STACK_BUFFER_OVERRUN`); use `-j 1` or Linux/CI.

Local HTTP smoke (`release` binary on `:8096`):

- `GET /healthz` → `vk_hash_hex=2f1075c2…9519e72` (matches on-chain)
- `POST /v1/prove/batch-groth16` → 256-byte `proof_base64`, same VK hash

## Enable on testnet (ops)

```
docker compose --profile groth16 up -d --build groth16-prover
# .env:
GROTH16_PROVER_URL=http://groth16-prover:8096
PROXYHUB_ZK_ONCHAIN_GROTH16_READY=true
PROXYHUB_ZK_ONCHAIN_GROTH16=true   # only after prover healthy
```

Do not enable require lane without a healthy prover — settlement will fail-closed.

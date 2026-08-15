# Evidence: Wave 5.A batch-digest-v2 (leaf-committed Groth16) — 2026-08-11

## Verdict

**OPS COMPLETE (devnet)** — digest-v2 binds `leaves_hash` into the Groth16 public input; program upgraded; prover/control-api redeployed; live settle + reputation credit verified.

## What changed

| Layer | Change |
|-------|--------|
| ADR | [`docs/adr/0010-trust-minimized-metering.md`](../../adr/0010-trust-minimized-metering.md) |
| Wave plan | [`docs/ops/WAVE5_DECENTRALIZATION_PLAN.md`](../WAVE5_DECENTRALIZATION_PLAN.md) |
| Digest | `SHA256(root‖count‖bytes‖window‖leaves_hash)` |
| Proof system | `groth16-bn254-batch-digest-v2` |
| VK_HASH | unchanged `2f1075c2…e72` (identity circuit) |
| Ix layout | +32 `leaves_hash` → 420-byte data |
| Aggregator | Fail-closed without leaf hashes when Groth16 on |

## Non-claims

- Not trustless metering (edge remains byte SoT)
- Not on-chain R1CS Merkle verification
- Not dual-sign / TEE

## Ops evidence

### 1. Program upgrade (proxyhub, `onchain-groth16`)

| Field | Value |
|-------|--------|
| Program | `AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu` |
| Upgrade authority | `6thzwmrfijDA5eukKzMAbQnL86RqdxiLx2maM94bRJcR` |
| `.so` size | 1069376 |
| `.so` SHA256 | `6DB9E283CFE75F9B0E6BA2D0EFC0DDCB332B697EE596434CB1476B948E1E1E8C` |
| Upgrade signature | `3r8YkN1L7TM8yHLTDmwJF4BfmUPpb8TJYPUjxnFPrrhEwGHd12ictqPbCGa2PPoqHbrFDQeZn9gWpZGXdZKYXgxr` |
| When (UTC) | 2026-08-11T21:31Z |

### 2. VM redeploy (`proxyhubb-testnet`)

- Synced digest-v2 Go/Rust sources; rebuilt `groth16-prover` + `control-api`
- Health: both containers healthy
- Prover: `proof_system=groth16-bn254-batch-digest-v2`, `vk_hash_hex=2f1075c22786a7763bfaee9ec39188b2aec7fb19de0aa1c3aac9e7ce29519e72`
- Public config: `zk_onchain_groth16_ready=true`, `provider_registry_gate=enforce`
- Log marker: `REDEPLOY_OK` / `END 2026-08-11T21:41:28Z`

### 3. Live smoke (`reputation_credit_e2e`)

| Field | Value |
|-------|--------|
| Root | `6fbe6120dd59b36102e1d60d65c73b5a5fa13c2feb2e5187a22da4e73d65dd22` |
| leaves_hash | `b91e6c960fa1cbbf1d90e48bc121d8dead45bbf507ac68a2b3730603b8e4616c` |
| proof_hash | `90784ac4e039ffaef8424974a098d6742b2ab3fe25d73aefed3437f79bf83782` |
| Settle sig | `RCgxmXpNVypHYikeRLeRPi5tcdFHMZvC91xtBC5G6SJ3PbricyFxSkErjYX7tg9DtJacYas71vaSYxneFnMn2oD` |
| ZKBatchPDA | `2iY7jRudvJCvwjjnb3pUdgbabSYh8QG5Xkpb4VRmfmJj` |
| Batch owner | `AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu` |
| Credit sig | `2jn8TsmBr6qAdmm1VwY1AbXqsJUEeQ9wMSVrQezQnBRXp9V5CuSrAqKYTUnJomkKW69AsArq9e1r64C1GToXrLcd` |
| Score | 103 → 104 |
| Provider | `8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2` |
| Result | `OK reputation_credit_e2e` |

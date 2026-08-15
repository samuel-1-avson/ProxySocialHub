# Evidence: Groth16 settlement lane enabled on testnet (2026-08-11)

## Verdict

**PASS (ops)** — BN254 prover live on `proxyhubb-testnet`; control-api require lane on;
prover-backed `submit_zk_batch_groth16` confirmed on Solana **devnet**.

## Testnet (`proxyhubb-testnet`)

| Item | Value |
|------|--------|
| Service | `proxyhubb-groth16-prover-1` (compose profile `groth16`) |
| Health VK | `2f1075c22786a7763bfaee9ec39188b2aec7fb19de0aa1c3aac9e7ce29519e72` |
| `.env` | `GROTH16_PROVER_URL=http://groth16-prover:8096` |
| | `PROXYHUB_ZK_ONCHAIN_GROTH16_READY=true` |
| | `PROXYHUB_ZK_ONCHAIN_GROTH16=true` |
| control-api env | Confirmed via `printenv` (same values) |
| Compose fix | Groth16 flags moved onto **control-api** (were wrongly on `zk-prover`) |
| Aggregator | `groth16_client.go` + `attachGroth16Proof` rebuilt into `proxyhubb-control-api` |

## Prover → on-chain settle (devnet)

Used `GROTH16_PROVER_URL` + `go run ./cmd/groth16_batch_e2e` (unique random root):

```
proved root=3d5b8443af8f030cc2b147b9b5760a642263678bc63bd0387411b6afcb7265d1
OK sig=pPqdDCwGdaKQ8pfdJ15CfKGJ3AMsm47WBH23ZHTgMEs2ovSkqps81GqSQCxxkjXNUysUoFRiurhEV4VjXYB48YH
batch_pda=5fTtZXLaBGgNBEtdrvWPcMXfL4Mahmm5v4CQJwmDCXLj
vk=2f1075c22786a7763bfaee9ec39188b2aec7fb19de0aa1c3aac9e7ce29519e72
```

## Notes

- Public `/v1/system/config/public` on the VM may still omit zk fields until a fuller source sync;
  **lane gating uses process env**, which is set.
- Do not pull an older GHCR control-api over this local rebuild without re-including Groth16 client wiring.
- Lane enable evidence: [`BC11_B_groth16_lane_enabled_20260811.md`](BC11_B_groth16_lane_enabled_20260811.md)
- Next (code): reputation consume + registry enforce — [`W4_2_reputation_consume_registry_enforce_20260811.md`](W4_2_reputation_consume_registry_enforce_20260811.md)

## Ops script

`scripts/ops-enable-groth16-lane.sh`

## Follow-on

Reputation ZKBatchPDA consume + registry gate enforce (code):
[`W4_2_reputation_consume_registry_enforce_20260811.md`](W4_2_reputation_consume_registry_enforce_20260811.md)

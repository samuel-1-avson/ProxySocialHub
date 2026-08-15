# Evidence: BC-11-B live Groth16 on-chain (2026-08-11)

## Verdict

**PASS** — `submit_zk_batch_groth16` verified a real BN254 proof on Solana **devnet**
and wrote `ZKBatchPDA`.

## Program upgrade

| Field | Value |
|-------|--------|
| Program ID | `AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu` |
| Feature | `--features onchain-groth16` |
| Extend | +65536 bytes (data length now `1088840`) |
| Upgrade #1 (verify body) | sig `2MhLb9VH2J59pZ6QqqmdRRsyu2Jfp3dsV4TA1emhmK7YKn3pUSbCUz7SMe1pKJUj8CAQd8UQw42W9EUxRd3Zj8nG` |
| Upgrade #2 (proof in ix) | sig `3uD9NkxiA89MXyRx4BCp7UcNUrDNPWuH3qS6Vqu5QqkQWBKQNJ4yiXFxEB3MHwgKgmehBPDVNcG2ZALczTK4VfgD` |
| Last deployed slot | `482922728` |
| Authority | `6thzwmrfijDA5eukKzMAbQnL86RqdxiLx2maM94bRJcR` |
| Local `.so` SHA-256 (v2) | `0AAB3D8009B63038E6552001F1E365906E709AC45182B2BDE0EDC46F48B714A8` |

## Live e2e

```
go run ./cmd/groth16_batch_e2e
# OK sig=3hnGMstsouGW3yXmR4MEcTzSVuLjn8ySzfik2YEEsxUANTc4wQBaCib8ssCkU9u7dWsjrw9xi1waFiXpmee1atng
# batch_pda=GP1NN2jXPpJEkoo53nU1ykhu8KoDwQ696fNDXp95JfL8
# vk=2f1075c22786a7763bfaee9ec39188b2aec7fb19de0aa1c3aac9e7ce29519e72
```

Sample inputs: root=`0x11`×32, sessions=3, bytes=1000, window=[1,2].

## Testnet flags

`proxyhubb-testnet` `.env`:

- `PROXYHUB_ZK_ONCHAIN_GROTH16=true` — require Groth16 settlement lane (**enabled** 2026-08-11; see `BC11_B_groth16_lane_enabled_20260811.md`)
- `PROXYHUB_ZK_ONCHAIN_GROTH16_READY=true` — verifier is live; client may send Groth16 txs
- `GROTH16_PROVER_URL=http://groth16-prover:8096`

Confirm via `printenv` inside control-api (`PROXYHUB_ZK_ONCHAIN_GROTH16=true`) and
`localhost:18080/v1/system/config/public` once sources expose those fields.

Lane enable evidence: [`BC11_B_groth16_lane_enabled_20260811.md`](BC11_B_groth16_lane_enabled_20260811.md).

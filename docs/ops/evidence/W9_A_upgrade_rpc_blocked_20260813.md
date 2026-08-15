# Evidence: Wave 9.A live upgrade blocked on RPC writes — 2026-08-13

## Verdict

**BLOCKED** — live ListingCommitment PDA **not** claimed.

The rebuilt `.so` is ready (local soak PASS). Devnet `solana program deploy`
failed on buffer **data writes** (`Max retries exceeded`) against public
devnet RPCs. `programs/session` was not deployed. GCP default stays **off**.

## What landed

Program `AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu`:

| Field | Before | After attempt |
|-------|--------|----------------|
| Slot | 483016399 | 483522475 |
| Data length | 1088840 | **1160552** (extended) |
| Authority | `6thzwmrfijDA5eukKzMAbQnL86RqdxiLx2maM94bRJcR` | unchanged |
| `Listing commitment registered` | no | **no** (dumped ELF) |
| Groth16 / BC-06 | yes | yes |

Dumped sha256 `1349BB83BDDF051B819899FC8DBDCA37AF448BD1D13EB1708567EE5F775DC990`
does **not** match laptop artifact
`4DC0D0A5ACD3CAFE824D81AFE8D3F672D276AF39FE346E750A4BCAC9B673925B`.
The account was resized; the executable bytes are still the previous Groth16
ELF. Leftover buffers were closed; lamports returned to the oracle fee payer.
A 2 SOL treasury loan was repaid.

## Why writes failed

Public `api.devnet.solana.com` and OnFinality public 429 / timeouts while
writing ~1.1MB buffer chunks. Upgrade authority was **not** copied to the app
VM. A keyed RPC (GCP Helius) is required to finish the copy + `program upgrade`.

Replay when a keyed RPC is available (devnet only, never session, never mainnet):

```
CONFIRM_W9A_UPGRADE=1
PAYER_KP=infra/oracle-keypair.json
RPC=<keyed-devnet-rpc>
bash scripts/upgrade-proxyhub-w9a-listing-commitment-devnet.sh
```

## Honesty

`listing_commitment_mode=off` on GCP.
`ix_status` remains absent for ListingCommitment.
Not a catalog. Not DePIN. Not `programs/session`.

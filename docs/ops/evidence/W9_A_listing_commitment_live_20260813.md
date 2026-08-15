# Evidence: Wave 9.A live ListingCommitment upgrade — 2026-08-13

## Verdict

**PASS** — `W9A_PROXYHUB_UPGRADE_DONE` (Solana **devnet**).

Live ELF now matches the laptop soak artifact. Both markers present.
`programs/session` was not deployed. GCP `PROXYHUB_LISTING_COMMITMENT` stays
**off** until a separate observe soak. Not a catalog. Not DePIN.

## Program

| Field | Before | After |
|-------|--------|--------|
| Program | `AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu` | unchanged |
| Authority | `6thzwmrfijDA5eukKzMAbQnL86RqdxiLx2maM94bRJcR` | unchanged |
| Slot | 483522475 | **483571293** |
| Data length | 1160552 | 1160552 |
| Dumped sha256 | `1349BB83…5DC990` (Groth16 only) | **`4DC0D0A5ACD3CAFE824D81AFE8D3F672D276AF39FE346E750A4BCAC9B673925B`** |
| `Listing commitment registered` | no | **yes** |
| Groth16 | yes | **yes** |

Upgrade signature:
`66Hnj1NN9sRmSM57H2cxR5K6iFTsctRcmogonJpPMyJnUf5rR2TcNuJ11ye862aQUrqGLnSrz1cys3rG61vwBoqd`

Buffer (consumed): `EjodVT37LgoZybrkBt1vKjRmq9EEnuUx8Ri486zAygoi`

## How (unpaid path)

Public `api.devnet.solana.com` cannot burst ~1.1MB via `solana program write-buffer`.
A throttled writer sent **800-byte** `Write` ixs, one confirmed tx at a time
(~44 min), then `set-buffer-authority` + `program deploy --buffer`.

Replay:

```
CONFIRM_W9A_UPGRADE=1
powershell -File scripts/w9a-throttled-upgrade.ps1
```

## Money

Treasury loaned 2 SOL for buffer rent; **1.993 SOL repaid** after upgrade.
No leftover buffers.

| Account | After |
|---------|--------|
| Oracle `8P4uuapg…Kii2` | 7.90061266 SOL |
| Treasury `8g7WUuPo…ktU4` | 3.120550786 SOL |

## Still unclaimed

- Live register (`CONFIRM_W9A_LIVE=1`) → ListingCommitment PDA
- PG `listing_commitment_on_chain` / `PROXYHUB_LISTING_COMMITMENT=observe`

## Honesty

`listing_commitment_mode=off` on GCP.
Not a search index. Not DePIN. Not `programs/session`.
Upgrade authority stayed on the laptop.

# Evidence: Wave 9.A ListingCommitment SBF soak — 2026-08-13

## Verdict

**PASS** — `W9A_LISTING_COMMITMENT_SOAK_OK` (local ProgramTest, SBF `.so`).

Live ListingCommitment PDA on devnet/GCP **not** claimed. `CONFIRM_W9A_UPGRADE=1`
was **not** set. gcp default stays **off**. `programs/session` was not deployed.

## Artifact

`services/solana-programs/proxyhub/target/deploy/proxyhub.so`

| Field | Value |
|-------|--------|
| sha256 | `4DC0D0A5ACD3CAFE824D81AFE8D3F672D276AF39FE346E750A4BCAC9B673925B` |
| size | 1160552 |
| `Listing commitment registered` | yes |
| `Groth16` | yes |
| `BC06 nonce bump` | yes |
| features | `onchain-groth16` |

Rebuild: Docker `rust:1.89-trixie` + `scripts/docker-build-proxyhub.sh`
(`CARGO_TARGET_DIR=/tmp/proxyhub-sbf`). SBF Cargo 1.84 required edition2024
pins (`enum-ordinalize` 4.3.2, `zeroize_derive` 1.4.2, `thiserror` 2.0.12,
`zerocopy` 0.8.26).

## Soak (2026-08-13)

`cargo test --test w9a_soak` loaded the ELF via `SBF_OUT_DIR` (not native
`processor!`). Program ID `AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu`.
Session program ID rejected.

```
Instruction: InitializeProgram
Instruction: RegisterListingCommitment
Program log: Listing commitment registered for provider GqZxLdAxkKUwPdC89hmsUkGHc933qfF7pGRVEC4DPJwT
pda=6LwmxjZiBLZk17YJgbvVpyUc5eahj8eMm7t9jm9rejcY
program=AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu
session_rejected=1
W9A_LISTING_COMMITMENT_SOAK_OK
test result: ok. 1 passed; 0 failed
```

Replay:

```
bash scripts/gcp-smoke-sprint-w9a-listing-commitment-soak.sh
```

(Windows host: run the same `cargo test --test w9a_soak` inside Docker with
`SBF_OUT_DIR=/workspace/target/deploy`.)

## Still unclaimed

- Live ELF upgrade (`CONFIRM_W9A_UPGRADE=1`, never session, never mainnet)
- Live register (`CONFIRM_W9A_LIVE=1`)
- PG `listing_commitment_on_chain` on a verified offer
- `PROXYHUB_LISTING_COMMITMENT=observe` on GCP

## Honesty

`listing_commitment_mode=off` on GCP (unchanged).
Live probe from earlier today: `ix_status=ix_absent` until upgrade.
Not a catalog / search index.
Not DePIN.
Not `programs/session`.

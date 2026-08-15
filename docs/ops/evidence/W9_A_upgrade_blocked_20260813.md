# Evidence: Wave 9.A live upgrade blocked — 2026-08-13

## Verdict

**BLOCKED** — live ListingCommitment PDA **not** claimed.

The leftover W5.C.5 deploy cannot run until `proxyhub.so` is rebuilt with
**both** ListingCommitment **and** Groth16. Current laptop artifact and live
devnet ELF are Groth16/BC-06 without the listing ix. `programs/session` was
not deployed.

## What was checked (2026-08-13)

Live program `AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu` (devnet):

- Upgrade authority matches cold key `6thzwmrfijDA5eukKzMAbQnL86RqdxiLx2maM94bRJcR`
- Last deployed slot `483016399`
- Public config: `zk_onchain_groth16_ready=true`

Laptop `target/deploy/proxyhub.so` (sha256 `6DB9E283…1E8C`):

| Marker | Present |
|--------|---------|
| `BC06 nonce bump` | yes |
| Groth16 / ZKBatch | yes |
| `Listing commitment registered` | **no** |
| `listing-commitment` seed | **no** |

Upgrading with this `.so` would **not** add ListingCommitment and must not
strip Groth16. Gated script refuses both cases:

`scripts/upgrade-proxyhub-w9a-listing-commitment-devnet.sh`  
(`CONFIRM_W9A_UPGRADE=1`, never session, never mainnet)

## Soak cluster

`programs/proxyhub/tests/w9a_soak.rs` initializes `program_state` then
`register_listing_commitment` and asserts the PDA.

Native `processor!` on Anchor 0.32 panics:

```
solana-invoke-0.4.0: not implemented: only supported with target_os = "solana"
```

Soak therefore requires an SBF `.so` that contains the ListingCommitment
marker (`SBF_OUT_DIR`). Replay after rebuild:

```
bash scripts/gcp-smoke-sprint-w9a-listing-commitment-soak.sh
```

## Rebuild (live upgrade)

Keep Groth16:

```
cd services/solana-programs/proxyhub
.\build-anchor-docker.ps1 -AnchorCommand "anchor build -p proxyhub --no-idl -- --features onchain-groth16"
```

Then confirm the `.so` greps both `Listing commitment registered` and `Groth16`
before `CONFIRM_W9A_UPGRADE=1`.

## Honesty

`listing_commitment_mode=off` on GCP  
`ix_status=ix_absent` on live ELF  
`programs_session=unsafe_do_not_deploy`

## Non-claims

- Not live ListingCommitment PDA
- Not a catalog / search index
- Not `PROXYHUB_LISTING_COMMITMENT=observe` on GCP
- Not `programs/session`
- Not DePIN
- Not a Groth16-stripping upgrade

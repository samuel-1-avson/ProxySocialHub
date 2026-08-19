# Evidence: W10.B shop publish wrote a ListingCommitment PDA — 2026-08-18

## Verdict

**PASS** — `W10B_LISTING_COMMITMENT_SHOP_PUBLISH_OK`.

`POST /v1/listings` (signed offer, `PROVIDER_SIGNATURE_MODE=enforce`) ran
`listing_commitment_sync` on Host-A. Postgres mirrored
`listing_commitment_on_chain=true`. Public devnet `getAccountInfo` shows
the PDA, owner `AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu`, space 98.

Capability stayed `observe`. Slash dual-gates unset.
`live_economic_slash=false`. Catalog stayed Postgres. Delist stayed
`platform_moderation`. Soak row was set `status=deleted` after the mirror
so it is not merchandised. Not a catalog index. Not enforce. Not DePIN.
Not `programs/session`.

This is the shop path, not the W9.A CLI soak
(`Ci1FqUWEdMZ8AtYjeoLrn3k9hkyW7rXR4zLb7RHZYC8R`).

## Why the first POST did not write

HTTP 201 at 09:30Z (`52b8b39b-15bd-454d-aa75-fb0f2a544aa6`) never mirrored.
The goroutine paniced at `listing_commitment.go` because
`c.oracleKey.PublicKey()` is empty on gcp-testnet (Cloud KMS;
`SOLANA_ORACLE_KEYPAIR` has no file). Register now uses
`GetOraclePublicKey()` (HSM/KMS), matching attestation and gateway-bond.

A second POST after that fix failed on OnFinality `-32029` (indexer load;
three RPC endpoints configured, last error still OnFinality). Sync now
retries transient blockhash errors. Attempt 3 succeeded.

## Shop row (devnet)

| Field | Value |
|-------|--------|
| Listing id | `8c76465d-c506-4d18-bf55-d671bcf069ec` |
| Seller | `b77e84c9-0e85-4f23-afc0-581cd561c216` |
| Soak node | `e4a5743a-87fe-4f90-b68e-0cc96181e245` (offline; do not reuse) |
| Signer | `4XdQ8RDKZHPwTP9buqZyKqQEUmmdZqLAN7xWE99iniao` |
| Offer hash | `0e8eed8985d3c9d728a6b98ff6ca31122c9b48cbd34b6c0c1da9f644372dc137` |
| PDA | `FGRAc7KGFMKAexL8LeXHee3UWy2wTfwa28osymBz6bkH` |
| Tx | `2kYfZUNsaybQnqmbPg2MHEXuzN8rVLF7u84y5gpTC98brzQmGcv2aQHHX84cHsxGhNP8Xyfu26K34TeDYzL7dCNX` |
| PG `listing_commitment_on_chain` | `true` |
| RPC account | present; owner proxyhub; space 98; rent 1_572_960 lamports |
| Title | `SOAK W10B listing sync 20260818T215313Z` (deleted after proof) |

Log: `listing commitment registered on-chain` at 2026-08-18T21:53:34Z.

## Replay

```
CONFIRM_W10B_SHOP_PUBLISH=1 SIGN_BIN=/tmp/provider_sign_listing \
  bash scripts/gcp-host-a-listing-commitment-shop-publish.sh
```

Requires `PROXYHUB_LISTING_COMMITMENT=observe`, six compose overlays
including `docker-compose.w10-listing-observe.yml`, no `--remove-orphans`,
slash unset. Prior `SOAK W10B listing sync%` rows are marked `deleted`
so they do not consume the seller listing quota.

## Host-A binary

Rolled 2026-08-18 for the KMS account-meta fix, then again for register
retries (`listing commitment: register retry` present on `/server`).
W10.A observe **restarts** on this image. Kill-API from 2026-08-18 was on
the 08-17 binary and does not cover this one. Decision due **2026-08-25**.
Rollback tag from the first 08-18 swap: `proxyhubb-control-api:pre-roll-20260818`.

## Non-claims

- Not listing-commitment **enforce** (browse still shows listings without a PDA)
- Not operator-minted session capability
- Not live slash
- Not `programs/session`
- Default compose without the listing overlay may still report `off`

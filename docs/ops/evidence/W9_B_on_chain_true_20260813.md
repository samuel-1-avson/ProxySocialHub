# Evidence: Wave 9.B bundle with live `on_chain=true` — 2026-08-13

## Verdict

**PASS** — `W9B_ON_CHAIN_TRUE` + `W9B_BUNDLE_VERIFY_OK`.

A signed listing-commitment bundle includes the live W9.A soak PDA after a
**read-only** RPC confirm. Title/media stay out of the bundle. GCP listing
mode stays **off**. Not a catalog. Not DePIN. `programs/session` unused.

## Proof

`w9b-listing-bundle emit-onchain` fetches
`Ci1FqUWEdMZ8AtYjeoLrn3k9hkyW7rXR4zLb7RHZYC8R` on
`https://api.devnet.solana.com`, refuses `on_chain=true` unless the PDA is
active, then signs.

```
W9B_ON_CHAIN_TRUE pda=Ci1FqUWEdMZ8AtYjeoLrn3k9hkyW7rXR4zLb7RHZYC8R n=1

12121212-1212-1212-1212-121212121212 hash=ab00… pda=Ci1FqUWEdMZ8AtYjeoLrn3k9hkyW7rXR4zLb7RHZYC8R on_chain=true verified=true
count=1 catalog_source=bundle
W9B_BUNDLE_VERIFY_OK
```

Unit: `TestSoakListingSeeds`, `TestFetchListingCommitmentRejectsSession`.

Replay:

```
CONFIRM_W9B_ONCHAIN=1 bash scripts/gcp-smoke-sprint-w9b-listing-bundle.sh
# or:
go run ./cmd/w9b-listing-bundle emit-onchain > bundle.json
go run ./cmd/w9b-listing-bundle list bundle.json
go run ./cmd/w9b-listing-bundle verify bundle.json
```

## Honesty

`on_chain=true` here is the **soak PDA**, not a merchandised shop listing and
not a PG `listing_commitment_on_chain` mirror. HTTP
`GET /v1/listings/commitments/bundle` still follows Postgres flags until
observe/sync. Delist stays platform.

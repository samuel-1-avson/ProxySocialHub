# Evidence: Wave 9.B listing-commitment bundle — 2026-08-13

## Verdict

**PASS** — `W9B_BUNDLE_VERIFY_OK` (unit). Live HTTP export on GCP **not**
required for this claim. Postgres remains the merchandising index.

## Exit claim

A portable JSON bundle of offer hashes (optional ListingCommitment PDAs)
verifies with Ed25519 without control-api. Honesty
`catalog_source=postgres_cache` when `PROXYHUB_LISTING_BUNDLE_PATH|URL|CID`
is pinned. Title/media stay Postgres. Not a shop-without-ProxyHubb catalog.

## Unit proof

```
go test ./internal/catalog/ ./internal/api/ -count=1 -run 'SourceDefault|BuildAndVerifyListingBundle|ParseBundle|DiscoveryHonesty'
# default catalog_source=postgres
# pin → postgres_cache
# sign/verify; wrong message_type rejected
```

`GET /v1/listings/commitments/bundle` is registered **before** `/listings/:id`.
CLI: `go run ./cmd/w9b-listing-bundle verify <file-or-url>`.

Without live W9.A PDAs, `pda` / `on_chain` fields may be empty — the bundle
is still a signed dump of Wave 3.2 offer hashes.

Live follow-up (same day): soak PDA confirmed on RPC and emitted with
`on_chain=true` — [`W9_B_on_chain_true_20260813.md`](W9_B_on_chain_true_20260813.md).

## Non-claims

- Not a merchandising CDN
- Not censorship-resistant browse
- Not live ListingCommitment PDAs (see W9.A probe `ix_absent`)
- Not DePIN
- Not `programs/session`

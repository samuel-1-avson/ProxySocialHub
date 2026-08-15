# Evidence: Wave 5.C.5 listing commitment PDA — 2026-08-12

## Verdict

**PASS** — `W5C_LISTING_COMMITMENT_OK` (unit / honesty / client).

Live on-chain register requires deploying the upgraded `proxyhub` program with
`register_listing_commitment`; gcp default `PROXYHUB_LISTING_COMMITMENT=off`
until that deploy.

## Exit claim

On-chain `ListingCommitment` PDA anchors verified `listing_offer_hash`
(seeds `listing-commitment` + provider + hash). PG mirror + browse honesty /
optional enforce filter. **Not** a full on-chain catalog.

## Unit proof

```
go test ./internal/solana/ -run ListingCommitment -count=1
go test ./internal/decentralization/ -run ListingCommitment -count=1
go test ./internal/api/ -run "DiscoveryHonesty|ListingCommitment" -count=1

# Covered:
# - ParseOfferHashHex + deterministic PDA
# - zero-hash reject before RPC
# - Mode off|observe|enforce
# - Honesty listing_commitments flips with mode
# - Browse enforce filter by listing_commitment_on_chain
```

`W5C_LISTING_COMMITMENT_OK`

## Changes

| Path | Role |
|------|------|
| `programs/proxyhub/.../lib.rs` | `ListingCommitment` account + register/deactivate ix |
| `solana/listing_commitment.go` | PDA + oracle client |
| `migrations/000149_listing_commitment.*` | PG mirror columns |
| `api/listing_commitment_sync.go` | Async register after verified offer |
| `api/listings_discovery.go` | Honesty + enforce filter |
| `docs/adr/0011-listing-commitment-pda.md` | Decision record |

## Non-claims

- Not a full on-chain catalog / search index
- Not censorship-resistant discovery (delist still platform)
- Not live register until program upgrade is deployed
- Not replacing W5.C.1 provider registry browse filter
- Merchandising (`catalog_products`) remains Postgres

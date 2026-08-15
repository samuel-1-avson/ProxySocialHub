# ADR 0011 — Listing commitment PDA (not full on-chain catalog)

## Status

Accepted (Wave 5.C.5) — 2026-08-12

## Context

Marketplace browse remains Postgres. Wave 3.2 published off-chain Ed25519
`listing_offer_hash`. Wave 5.C.1 hard-filters browse by **provider** registry
mirror (`is_registered_on_chain`). The deferred epic was an on-chain **listing**
index — without overclaiming a censorship-resistant catalog.

## Decision

### D1 — Commitment PDA, not catalog PDA

Extend `proxyhub` with `ListingCommitment` accounts:

- Seeds: `["listing-commitment", provider_pubkey, offer_hash_32]`
- Fields: provider, offer_hash, listing_id (UUID bytes), is_active, registered_at, bump
- Ix: `register_listing_commitment` / `deactivate_listing_commitment` (oracle-admin, same as ProviderRegistry)

Merchandising (`catalog_products`, title, media, search) stays Postgres.

### D2 — Mode flag

`PROXYHUB_LISTING_COMMITMENT=off|observe|enforce` (default **off**).

- observe: best-effort oracle register after verified offer; PG mirror; browse annotation
- enforce: also hard-filter browse/map by `listing_commitment_on_chain`

### D3 — Honesty

`discovery.listing_commitments` becomes `ed25519_offer_hash+listing_commitment_pda`
when mode ≠ off. `catalog_source` remains `postgres`. Delist authority remains
platform moderation.

## Consequences

- Listing offer hashes can be independently verified on-chain once the upgraded
  program is deployed.
- Platform can still delist in Postgres; deactivate ix marks PDA inactive.
- Full on-chain catalog / trustless discovery remains out of scope.
- Live proof requires deploying the upgraded `proxyhub` program; unit tests cover
  PDA derivation + honesty without that deploy.

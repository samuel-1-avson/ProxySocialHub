# Evidence: Wave 9.A ListingCommitment probe — 2026-08-13

## Verdict

**PASS (probe / CLI)** — `W9A_LISTING_COMMITMENT_OK` (unit + read-only probe).

Live PDA register **not** claimed. Live `proxyhub`
(`AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu`) ELF does **not** contain
`register_listing_commitment`. `programs/session` was not deployed.

## Exit claim (this slice)

CLI + honesty + bytecode probe for leftover W5.C.5. Observe soak
(verified offer → PDA + PG `listing_commitment_on_chain`) stays gated
(`CONFIRM_W9A_LIVE=1`) until the upgraded program is on the cluster.

## Proof (2026-08-13)

```
go test ./internal/solana/ ./internal/decentralization/ ./internal/api/ -count=1 -run 'ListingCommitment|DiscoveryHonesty|ClassifyListingCommitment'
# PDA deterministic, parse account, session program rejected, honesty flips

go run ./cmd/w9a-listing-commitment honesty
# listing_commitment_mode=off listing_commitments=ed25519_offer_hash
# catalog_source=postgres gcp_default=off not_a_catalog=true

go run ./cmd/w9a-listing-commitment probe
{"program_id":"AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu","executable":true,"marker_in_elf":false,"existing_pdas":0,"ix_status":"ix_absent","message":"program is executable but ListingCommitment marker was not found in ELF — upgrade still pending","programs_session":"unsafe_do_not_deploy"}
```

`W9A_LISTING_COMMITMENT_OK`  
`W9A_IX_NOT_ON_LIVE`

Replay: `bash scripts/gcp-smoke-sprint-w9a-listing-commitment.sh`

## Honesty (GCP)

`listing_commitments=ed25519_offer_hash`  
`listing_commitment_mode=off`  
`catalog_source=postgres`  
`programs_session=unsafe_do_not_deploy`

Live upgrade remains a dedicated ops step (cold upgrade authority). This
script refuses `CONFIRM_W9A_DEPLOY=1`. Never session.

## Non-claims

- Not live ListingCommitment PDA
- Not on-chain search / merchandising catalog
- Not censorship-resistant browse (delist stays platform)
- Not `PROXYHUB_LISTING_COMMITMENT=observe` on GCP
- Not `programs/session`
- Not DePIN

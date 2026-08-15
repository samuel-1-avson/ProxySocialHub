# Evidence: Wave 9.A live ListingCommitment PDA — 2026-08-13

## Verdict

**PASS** — `W9A_LISTING_COMMITMENT_LIVE_OK` (Solana **devnet** soak PDA).

`programs/session` was not deployed. GCP `PROXYHUB_LISTING_COMMITMENT` stays
**off**. Not a catalog. Not DePIN.

## PDA

| Field | Value |
|-------|--------|
| PDA | `Ci1FqUWEdMZ8AtYjeoLrn3k9hkyW7rXR4zLb7RHZYC8R` |
| Program | `AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu` |
| Provider (soak) | `8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2` (oracle; `program_state.admin`) |
| Offer hash | `ab00000000000000000000000000000000000000000000000000000000000000` |
| Listing id | `12121212-1212-1212-1212-121212121212` |
| Active | true |
| Owner | proxyhub |
| Tx | `2cx2xT52JrY6NURTXtNXvXHqdxQgGmiAzyuH2XaUNvUegBzQjjQj6PWbGiP35VEu6v4wXGADubhLjBda7G1RENpk` |
| Slot | 483573206 |

On-chain log: `Listing commitment registered for provider 8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2`

Probe after register: `marker_in_elf=true` `existing_pdas=1` `ix_status=ix_present`

## Replay

```
CONFIRM_W9A_LIVE=1
SOLANA_ORACLE_KEYPAIR=infra/oracle-keypair.json
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_PROGRAM_ID=AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu
go run ./cmd/w9a-listing-commitment register \
  8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2 \
  ab00000000000000000000000000000000000000000000000000000000000000 \
  12121212-1212-1212-1212-121212121212
```

This soak uses a dedicated hash/listing id, not a merchandised shop listing.
PG `listing_commitment_on_chain` / GCP observe remain **off**.

## Honesty

`listing_commitment_mode=off` on GCP.
Not on-chain search. Delist stays platform.
Not `programs/session`. Not DePIN.

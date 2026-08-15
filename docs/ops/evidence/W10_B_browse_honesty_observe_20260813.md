# Evidence: Wave 10.B browse honesty when observe — 2026-08-13

## Verdict

**PASS** — `W10B_BROWSE_HONESTY_OBSERVE_OK` + `W10B_RESTORED_OFF`.

`GET /v1/system/config/public` and `GET /v1/listings` reported
`listing_commitments=ed25519_offer_hash+listing_commitment_pda` while
`PROXYHUB_LISTING_COMMITMENT=observe`, then GCP was restored to **off**.
Not a catalog. Not DePIN. `programs/session` unused. Delist stayed
`platform_moderation`.

## Proof

Host-A (`proxyhubb-testnet`) control-api still hardcoded
`listing_commitments=ed25519_offer_hash` (no `listing_commitment_mode`).
Honesty-only rebuild (no `listing_commitment_sync`, so this observe window
did **not** register PDAs on listing publish).

```
in_container mode=observe commitments=ed25519_offer_hash+listing_commitment_pda catalog=postgres delist=platform_moderation
public_config mode=observe commitments=ed25519_offer_hash+listing_commitment_pda catalog=postgres delist=platform_moderation
listings mode=observe commitments=ed25519_offer_hash+listing_commitment_pda catalog=postgres delist=platform_moderation
W10B_BROWSE_HONESTY_OBSERVE_OK
```

Restore (same new binary, env unset/off):

```
restored_inner mode=off commitments=ed25519_offer_hash catalog=postgres delist=platform_moderation
W10B_RESTORED_OFF
```

Public API after restore (`https://api.proxyhubb.com`):

```
listing_commitment_mode=off
listing_commitments=ed25519_offer_hash
catalog_source=postgres
delist_authority=platform_moderation
```

Unit (laptop): `TestDiscoveryHonestyMeta`,
`TestGetListings_DiscoveryHonestyObserve`,
`TestGetPublicSystemConfig_ListingCommitmentObserveHonesty`.

Replay:

```
CONFIRM_W10B_OBSERVE=1 bash scripts/gcp-smoke-sprint-w10b-browse-honesty.sh
```

On Host-A the script rebuilds if discovery still hardcodes hash-only
(`/tmp/w10b-listings_discovery.go` patch). Always restores env **off**.

## Honesty

- Catalog remains Postgres. Observe annotates browse; it is not on-chain search.
- Enforce (hide listings without PDA mirror) was **not** enabled.
- Host-A still lacks `listing_commitment_sync` / W9.B HTTP bundle pin.
- GCP `PROXYHUB_LISTING_COMMITMENT` default stays **off**.

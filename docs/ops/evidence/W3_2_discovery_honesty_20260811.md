# W3.2 — Discovery index honesty

| Field | Value |
|-------|-------|
| Date | 2026-08-11 |
| Result | `DISC01_DISCOVERY_HONESTY_LANDED` |

## What landed

1. Top-level `discovery` meta on `GET /v1/listings`, listing detail, `/v1/marketplace/map`, `/v1/listings/geo`, and `/v1/system/config/public`.
2. Listing enrich: `provider_registered_on_chain`, `provider_has_hotkey` from Postgres (no per-row RPC).
3. Optional `include=registry` on single listing → `registry_live` via `providergate.LiveStatus` (one RPC).
4. Map/geo pins: `listing_offer_hash`, `provider_registered_on_chain`.
5. Docs: `docs/MARKETPLACE_DISCOVERY_API.md` Wave 3.2 section.

## Non-claims

- Catalog still Postgres — platform can still delist
- Offer hash ≠ on-chain listing PDA
- Browse does not filter by live registry (activation gate is W3.1)

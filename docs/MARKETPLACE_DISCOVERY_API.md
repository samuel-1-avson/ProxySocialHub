# Marketplace Discovery API

Canonical buyer discovery surface: **`GET /v1/listings`** (and related listing routes under `/v1/listings/*`).

`GET /v1/services` remains a deprecated thin adapter; new clients should use listings.

**Routes that do NOT exist** (probed and confirmed 404 — do not document or integrate against them):
`GET /v1/nodes`, `GET /v1/providers` (list), `GET /v1/discovery/browse`. The public surface is:
listings (`/v1/listings*`), map topology (`/v1/map/points`, `/v1/map/links`), gateway operator
discovery (`/v1/gateways/operators*`, Wave 5.B), and provider-scoped node management under auth
(`/v1/provider/nodes*`, `/v1/providers/:id/tier`). The OpenAPI contract is served at
`https://docs.proxyhubb.com/openapi.yaml`; `api.proxyhubb.com/openapi.json` and `/openapi.yaml`
redirect there.

## Wave 3.2 — Discovery honesty (DISC-01)

Browse and map responses include a top-level `discovery` object:

```json
{
  "discovery": {
    "catalog_source": "postgres",
    "delist_authority": "platform_moderation",
    "registry_gate_mode": "off|observe|enforce",
    "browse_registry_filter": "off|observe|enforce",
    "listing_commitment_mode": "off|observe|enforce",
    "listing_commitments": "ed25519_offer_hash|ed25519_offer_hash+listing_commitment_pda",
    "note": "..."
  }
}
```

Listing rows may also expose:

| Field | Meaning |
|-------|---------|
| `listing_offer_hash` | Off-chain Ed25519 offer commitment |
| `listing_commitment_pda` | On-chain ListingCommitment PDA (W5.C.5 mirror) |
| `listing_commitment_on_chain` | PG mirror: offer hash registered on-chain |
| `provider_registered_on_chain` | PG mirror of hotkey `register_provider` |
| `provider_has_hotkey` | Node has a bound Solana hotkey |
| `registry_live` | Only when `include=registry` on **single** listing GET (one RPC) |

**Honest limits:** Delist/reject remains platform moderation. Merchandising catalog stays Postgres. `PROXYHUB_PROVIDER_REGISTRY_GATE` affects session activation / smart-match (W3.1). `PROXYHUB_BROWSE_REGISTRY_FILTER=enforce` (W5.C.1) hard-filters by provider registry mirror. `PROXYHUB_LISTING_COMMITMENT=observe|enforce` (W5.C.5 / ADR 0011) anchors offer hashes as `ListingCommitment` PDAs — **not** a full on-chain catalog index. `GET /v1/listings/commitments/bundle` exports a signed offer-hash set (Wave 9.B). `catalog_source` becomes `postgres_cache` when `PROXYHUB_LISTING_BUNDLE_PATH|URL|CID` is pinned. Verify without the API: `w9b-listing-bundle verify <file>`.

Also on `/v1/system/config/public`: `discovery` + `provider_registry_gate`.

**Metric honesty (E.2):** listing payloads carry `sla_source` ∈ `gateway|explorer|provider|listing`.
Only the first three are live measurements; `listing` means the uptime/latency/success-rate
values are unmeasured defaults and clients must render them as "Unmeasured" (the web app does).
`quality_score` is a ranking hint, not a measurement. Public listing reads obfuscate the signed
`country`/`isp` to `Hidden until session` — that is intentional pre-purchase privacy, not a
verified quality claim.

## Phase 3A: optional catalog product embed

Listings stay the fulfillment/supply record. Merchandising lives in `catalog_products` / `catalog_offers` (see [MARKETPLACE_CATALOG_BACKFILL_RUNBOOK.md](./MARKETPLACE_CATALOG_BACKFILL_RUNBOOK.md)).

### Query parameter

| Param | Values | Effect |
|-------|--------|--------|
| `include` | `product`, `catalog`, or `catalog_product` (comma-separated allowed) | When set, each listing may include `catalog_product` |

Applies to:

- `GET /v1/listings`
- `GET /v1/listings/{id}`
- `GET /v1/listings/collections/{slug}`
- `GET /v1/listings/featured` (and other listing list helpers that call the shared enricher)
- Map points: `include_catalog=true` **or** `include=product` on marketplace map

### Response shape (non-breaking)

```json
{
  "listings": [
    {
      "id": "...",
      "title": "Supply listing title",
      "catalog_product": {
        "id": "...",
        "slug": "premium-us-pool-a1b2c3d4",
        "title": "Merchandised title",
        "media": [],
        "status": "active"
      }
    }
  ]
}
```

Rules:

- Listings **without** a catalog offer omit `catalog_product` (field absent / null).
- Draft / archived products are hidden from anonymous buyers; the owning seller may see them when authenticated.
- Omitting `include` never adds `catalog_product` (existing clients unchanged).
- Responses with `include=product` bypass the short listings cache (shape differs).

### Collections

Phase 2 collection slugs (`featured`, `verified`, `editors-pick`) are unchanged. Collection pages accept the same `include=product` flag and enrich via offers — they do **not** require collection config to reference catalog IDs.

### Examples

```http
GET /v1/listings?include=product
GET /v1/listings/{id}?include=product
GET /v1/listings/collections/featured?include=product&page=1&limit=20
```

### Related

- ADR: [adr/0005-marketplace-catalog-layer.md](./adr/0005-marketplace-catalog-layer.md) — Phase 3A-5
- Catalog CRUD: OpenAPI tag **Catalog** (`/v1/catalog/*`) — Phase 3A-2
- Schema / backfill: migration `000097`, runbook above — Phase 3A-1
- Track status: [reports/MARKETPLACE_PHASE3A_STATUS.md](./reports/MARKETPLACE_PHASE3A_STATUS.md)

# Marketplace Discovery API

Canonical buyer discovery surface: **`GET /v1/listings`** (and related listing routes under `/v1/listings/*`).

`GET /v1/services` remains a deprecated thin adapter; new clients should use listings.

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

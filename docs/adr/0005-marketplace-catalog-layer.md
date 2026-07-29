# ADR 0005 — Marketplace catalog layer (Phase 3A)

- **Status:** Accepted (shipped)
- **Date:** 2026-06-03 (decisions) · 2026-07-29 (3A exit sign-off)
- **Epic:** GitHub [#8](https://github.com/samuel-1-avson/ProxySocialHub/issues/8)
- **Issue:** [#13](https://github.com/samuel-1-avson/ProxySocialHub/issues/13) (3A-5)
- **OpenAPI:** [openapi.yaml](../openapi.yaml) tag **Catalog**
- **Discovery embed:** [MARKETPLACE_DISCOVERY_API.md](../MARKETPLACE_DISCOVERY_API.md)
- **Migration:** `migrations/000097_catalog_products_offers.{up,down}.sql`
- **Backfill:** [MARKETPLACE_CATALOG_BACKFILL_RUNBOOK.md](../MARKETPLACE_CATALOG_BACKFILL_RUNBOOK.md)
- **Track status:** [reports/MARKETPLACE_PHASE3A_STATUS.md](../reports/MARKETPLACE_PHASE3A_STATUS.md)

---

## Context

Phase 2 delivered listing-centric discovery (`GET /v1/listings`), code-defined collections, and moderation on `proxy_listings`. Sellers still think in “one listing = one card,” but merchandising (copy, media, multi-SKU products) needs a layer **above** supply rows without breaking escrow, credentials, or order FKs.

This ADR records the **Option B** choice from the marketplace report (§11): a thin catalog projection, not a rewrite of commerce.

## Decision

### D1 — Two-table catalog projection (Accepted)

| Table | Purpose |
|-------|---------|
| `catalog_products` | Merchandising: title, description, slug, media, product status |
| `catalog_offers` | Join: `product_id` ↔ `listing_id`, optional SKU, primary flag |

`proxy_listings` remains the **supply and fulfillment** source (node, proofs, bandwidth, `pending_review`).

### D2 — Orders and buy flow unchanged (Accepted)

Orders continue to reference `listing_id` only. Catalog IDs are optional enrichment on browse/detail (`?include=product`), not a new checkout identifier.

### D3 — Backfill identity: product id = listing id (Accepted)

For every non-deleted listing, migration `000097` inserts:

- `catalog_products.id = proxy_listings.id`
- `catalog_offers` with `product_id = listing_id = listing.id`, `is_primary = true`

**Rationale:** Idempotent `ON CONFLICT DO NOTHING`; no orphan mapping table; re-runs safe after partial apply.

**Consequence:** Products created via API (3A-2) use **new** UUIDs; only backfilled rows share id with listings. Application code must not assume `product.id == listing.id` for user-created products.

### D4 — Product status vs listing status (Accepted)

| Listing status | Product status (backfill) |
|----------------|---------------------------|
| `pending_review` | `draft` |
| `active`, `paused`, `sold_out`, … | `active` |
| `deleted` | (no product row) |

Moderation gates remain on the **listing**. A `draft` product may still link to a listing in `pending_review`. Seller edits after backfill are authoritative for product status (repair only promotes projected draft→active when the listing left `pending_review`).

### D5 — Slug uniqueness (Accepted)

`(seller_id, slug)` unique. Backfill slug = sanitized title + `-` + first 8 hex chars of listing id (collision-free).

### D6 — Collections stay listing-based (Accepted)

Phase 2 collection slugs keep listing queries. Buyers pass `?include=product` to enrich cards via `catalog_offers`; collection config does **not** need to reference catalog IDs for 3A.

### D7 — Listing-only model mapping (Accepted)

| Listing-only concept | Catalog projection |
|----------------------|--------------------|
| Listing title/description on card | Prefer `catalog_products` when an offer links the listing |
| One card per listing | Still true for buy; product may attach many listings as offers |
| `/v1/listings` as discovery | Unchanged; catalog is additive embed + seller CRUD under `/v1/catalog` |
| Checkout / escrow / credentials | Still keyed by `listing_id` / order |

## Alternatives considered

| Option | Rejected because |
|--------|------------------|
| Replace `proxy_listings` with products | Breaks orders, escrow, provider node FKs |
| Separate backfill mapping table | Extra join forever; shared UUID sufficient for 1:1 migrate |
| Product-only API without offers | Cannot attach multiple listings per product |
| Option C (order FSM) as first Phase 3 track | Deferred; 3A unblocks merchandising with lower migration risk |

## Consequences

- **Positive:** Clear merchandising model; multi-offer products supported via offers API.
- **Positive:** Zero buyer API break when `include` is omitted.
- **Negative:** Possible title/description drift between product and listing until sellers edit in manage UI.
- **Operational:** After `000097`, run verification SQL in the backfill runbook on staging.

## Sign-off checklist (#13)

- [x] Schema reviewed (migration `000097` + models)
- [x] Backfill strategy documented (D3–D4) + runbook SQL
- [x] Rollback: `000097_catalog_products_offers.down.sql`
- [x] Catalog REST paths in OpenAPI tag **Catalog** (#10)
- [x] Discovery `include=product` documented (#11)
- [x] Web manage + browse enrichment (#12)
- [ ] Supabase RLS policies (follow `proxy_listings` pattern when PostgREST exposure is required — not needed for control-api-only access)

# Marketplace catalog backfill runbook (Phase 3A-1 / 3A-5)

Canonical migration: `migrations/000097_catalog_products_offers.{up,down}.sql`  
Go re-run helper: `catalog.BackfillFromListings()` in `services/control-api/internal/marketplace/catalog`  
Architecture: [adr/0005-marketplace-catalog-layer.md](./adr/0005-marketplace-catalog-layer.md)

## What the backfill does

For every `proxy_listings` row with `status <> 'deleted'`:

1. Inserts a `catalog_products` row with **`id = listing.id`** (idempotent key).
2. Inserts a primary `catalog_offers` row linking `product_id = listing_id = listing.id`.
3. Maps `pending_review` listings → product status `draft`; all other non-deleted → `active`.

Re-running the migration SQL or `BackfillFromListings()` is safe (`ON CONFLICT DO NOTHING`). The Go helper also repairs draft→active drift and missing primary flags when offer rows already exist.

## Apply (staging / prod)

```bash
# Compose (preferred)
docker compose run --rm db-migrate

# Or control-api migrate entrypoint
go run ./services/control-api migrate up
```

After deploy of a build that includes the Go helper, operators can also trigger a no-op re-projection via a one-off process that calls `catalog.BackfillFromListings()` (same SQL as the migration).

## Verification SQL

Run after migrate (and after any manual re-backfill). All “expect” checks must pass before promoting the release.

```sql
-- Coverage: product count, offer count vs eligible listings
SELECT
  (SELECT COUNT(*) FROM proxy_listings WHERE status <> 'deleted') AS eligible_listings,
  (SELECT COUNT(*) FROM catalog_products) AS products,
  (SELECT COUNT(*) FROM catalog_offers) AS offers;
-- After initial backfill: products >= eligible_listings and offers >= eligible_listings
-- (sellers may create extra products/offers later; never fewer than eligible for the 1:1 migrate path)

-- Every non-deleted listing must have exactly one primary offer
SELECT COUNT(*) AS missing_primary
FROM proxy_listings pl
WHERE pl.status <> 'deleted'
  AND NOT EXISTS (
    SELECT 1 FROM catalog_offers o
    WHERE o.listing_id = pl.id AND o.is_primary = TRUE
  );
-- expect: 0

-- Orphan offers: listing_id with no proxy_listings row (FK should already enforce)
SELECT COUNT(*) AS orphan_offers
FROM catalog_offers o
WHERE NOT EXISTS (SELECT 1 FROM proxy_listings pl WHERE pl.id = o.listing_id);
-- expect: 0

-- Orphan offers: product_id with no catalog_products row
SELECT COUNT(*) AS orphan_offer_products
FROM catalog_offers o
WHERE NOT EXISTS (SELECT 1 FROM catalog_products cp WHERE cp.id = o.product_id);
-- expect: 0

-- Backfilled products missing any offer (should not happen after 000097 / BackfillFromListings)
SELECT COUNT(*) AS products_without_offers
FROM catalog_products cp
WHERE NOT EXISTS (SELECT 1 FROM catalog_offers o WHERE o.product_id = cp.id)
  AND EXISTS (SELECT 1 FROM proxy_listings pl WHERE pl.id = cp.id AND pl.status <> 'deleted');
-- expect: 0

-- At most one primary per product
SELECT product_id, COUNT(*) AS primaries
FROM catalog_offers
WHERE is_primary = TRUE
GROUP BY product_id
HAVING COUNT(*) > 1;
-- expect: 0 rows
```

### Operator one-liner (psql)

```bash
psql "$DATABASE_URL" -c "
SELECT
  (SELECT COUNT(*) FROM proxy_listings WHERE status <> 'deleted') AS eligible_listings,
  (SELECT COUNT(*) FROM catalog_products) AS products,
  (SELECT COUNT(*) FROM catalog_offers) AS offers,
  (SELECT COUNT(*) FROM proxy_listings pl
     WHERE pl.status <> 'deleted'
       AND NOT EXISTS (
         SELECT 1 FROM catalog_offers o
         WHERE o.listing_id = pl.id AND o.is_primary = TRUE
       )) AS missing_primary,
  (SELECT COUNT(*) FROM catalog_offers o
     WHERE NOT EXISTS (SELECT 1 FROM proxy_listings pl WHERE pl.id = o.listing_id)) AS orphan_offers;
"
# expect missing_primary = 0 and orphan_offers = 0
```

## Rollback

```bash
# Rolls back catalog tables only (data loss for catalog_products / catalog_offers)
psql "$DATABASE_URL" -f migrations/000097_catalog_products_offers.down.sql
```

`proxy_listings` are untouched. After rollback, re-apply `000097` to restore the 1:1 projection.

## Acceptance checklist

### Issue #9 (3A-1)

- [x] Migrations create `catalog_products` + `catalog_offers`
- [x] Backfill is idempotent
- [x] Non-deleted listings have a primary offer after backfill
- [x] No orphan `catalog_offers.listing_id`
- [x] Go tests cover backfill parity + re-run

### Issue #13 (3A-5)

- [x] Verification SQL covers product count, offer count, and orphan checks
- [x] ADR documents listing-only → catalog mapping ([adr/0005](./adr/0005-marketplace-catalog-layer.md))
- [x] OpenAPI Catalog tag lists 3A-2 paths ([openapi.yaml](./openapi.yaml))

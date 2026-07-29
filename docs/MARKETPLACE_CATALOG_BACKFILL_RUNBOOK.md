# Marketplace catalog backfill runbook (Phase 3A-1)

Canonical migration: `migrations/000097_catalog_products_offers.{up,down}.sql`  
Go re-run helper: `catalog.BackfillFromListings()` in `services/control-api/internal/marketplace/catalog`.

## What the backfill does

For every `proxy_listings` row with `status <> 'deleted'`:

1. Inserts a `catalog_products` row with **`id = listing.id`** (idempotent key).
2. Inserts a primary `catalog_offers` row linking `product_id = listing_id = listing.id`.
3. Maps `pending_review` listings → product status `draft`; all other non-deleted → `active`.

Re-running the migration SQL or `BackfillFromListings()` is safe (`ON CONFLICT DO NOTHING`).

## Apply (staging / prod)

```bash
# Compose (preferred)
docker compose run --rm db-migrate

# Or control-api migrate entrypoint
go run ./services/control-api migrate up
```

After deploy of a build that includes the Go helper, operators can also trigger a no-op re-projection via a one-off process that calls `catalog.BackfillFromListings()` (same SQL as the migration).

## Verification SQL

```sql
-- Eligible listings vs catalog coverage
SELECT
  (SELECT COUNT(*) FROM proxy_listings WHERE status <> 'deleted') AS eligible_listings,
  (SELECT COUNT(*) FROM catalog_products) AS products,
  (SELECT COUNT(*) FROM catalog_offers) AS offers;

-- Every non-deleted listing must have exactly one primary offer
SELECT COUNT(*) AS missing_primary
FROM proxy_listings pl
WHERE pl.status <> 'deleted'
  AND NOT EXISTS (
    SELECT 1 FROM catalog_offers o
    WHERE o.listing_id = pl.id AND o.is_primary = TRUE
  );
-- expect: 0

-- No orphan offers (FK should already enforce this)
SELECT COUNT(*) AS orphan_offers
FROM catalog_offers o
WHERE NOT EXISTS (SELECT 1 FROM proxy_listings pl WHERE pl.id = o.listing_id);
-- expect: 0

-- At most one primary per product
SELECT product_id, COUNT(*) AS primaries
FROM catalog_offers
WHERE is_primary = TRUE
GROUP BY product_id
HAVING COUNT(*) > 1;
-- expect: 0 rows
```

## Rollback

```bash
# Rolls back catalog tables only (data loss for catalog_products / catalog_offers)
psql "$DATABASE_URL" -f migrations/000097_catalog_products_offers.down.sql
```

`proxy_listings` are untouched. After rollback, re-apply `000097` to restore the 1:1 projection.

## Acceptance checklist (issue #9)

- [x] Migrations create `catalog_products` + `catalog_offers`
- [x] Backfill is idempotent
- [x] Non-deleted listings have a primary offer after backfill
- [x] No orphan `catalog_offers.listing_id`
- [x] Go tests cover backfill parity + re-run

-- Phase 3A: catalog projection (products + offers) above proxy_listings.
-- Backfill uses listing UUID as product UUID for idempotent 1:1 migration.

CREATE TABLE IF NOT EXISTS catalog_products (
    id          UUID PRIMARY KEY,
    seller_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    slug        VARCHAR(120) NOT NULL,
    title       VARCHAR(200) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    media       JSONB NOT NULL DEFAULT '[]',
    status      VARCHAR(32) NOT NULL DEFAULT 'active'
        CHECK (status IN ('draft', 'active', 'archived')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_catalog_products_seller_slug UNIQUE (seller_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_catalog_products_seller
    ON catalog_products (seller_id);

CREATE INDEX IF NOT EXISTS idx_catalog_products_status
    ON catalog_products (status)
    WHERE status = 'active';

CREATE TABLE IF NOT EXISTS catalog_offers (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id   UUID NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,
    listing_id   UUID NOT NULL REFERENCES proxy_listings(id) ON DELETE CASCADE,
    sku          VARCHAR(64),
    display_name VARCHAR(200),
    is_primary   BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order   INT NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_catalog_offers_listing UNIQUE (listing_id)
);

CREATE INDEX IF NOT EXISTS idx_catalog_offers_product
    ON catalog_offers (product_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_offers_one_primary_per_product
    ON catalog_offers (product_id)
    WHERE is_primary = TRUE;

-- Idempotent backfill: product id = listing id for migrated rows.
INSERT INTO catalog_products (
    id,
    seller_id,
    slug,
    title,
    description,
    media,
    status,
    created_at,
    updated_at
)
SELECT
    pl.id,
    pl.seller_id,
    trim(both '-' from regexp_replace(
        coalesce(nullif(regexp_replace(lower(substring(pl.title from 1 for 80)), '[^a-z0-9]+', '-', 'g'), ''), 'listing'),
        '-{2,}', '-', 'g'
    )) || '-' || left(replace(pl.id::text, '-', ''), 8),
    pl.title,
    coalesce(pl.description, ''),
    '[]'::jsonb,
    CASE pl.status
        WHEN 'pending_review' THEN 'draft'
        ELSE 'active'
    END,
    pl.created_at,
    pl.updated_at
FROM proxy_listings pl
WHERE pl.status <> 'deleted'
ON CONFLICT (id) DO NOTHING;

INSERT INTO catalog_offers (
    product_id,
    listing_id,
    is_primary,
    sort_order,
    created_at
)
SELECT
    pl.id,
    pl.id,
    TRUE,
    0,
    pl.created_at
FROM proxy_listings pl
WHERE pl.status <> 'deleted'
  AND EXISTS (SELECT 1 FROM catalog_products cp WHERE cp.id = pl.id)
ON CONFLICT (listing_id) DO NOTHING;

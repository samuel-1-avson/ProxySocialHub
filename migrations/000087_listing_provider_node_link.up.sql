-- Link marketplace listings to provider infrastructure for map geo resolution.

ALTER TABLE proxy_listings
    ADD COLUMN IF NOT EXISTS provider_node_id UUID REFERENCES provider_nodes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_proxy_listings_provider_node_id
    ON proxy_listings (provider_node_id)
    WHERE provider_node_id IS NOT NULL;

-- Backfill: one provider node per seller (prefer online, then most recently seen).
UPDATE proxy_listings pl
SET provider_node_id = (
    SELECT pn.id
    FROM provider_nodes pn
    WHERE pn.user_id = pl.seller_id
    ORDER BY
        CASE WHEN pn.status = 'online' THEN 0 ELSE 1 END,
        pn.last_seen_at DESC NULLS LAST,
        pn.created_at DESC
    LIMIT 1
)
WHERE pl.provider_node_id IS NULL;

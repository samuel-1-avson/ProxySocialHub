DROP INDEX IF EXISTS idx_proxy_listings_provider_node_id;

ALTER TABLE proxy_listings
    DROP COLUMN IF EXISTS provider_node_id;

DROP INDEX IF EXISTS idx_proxy_listings_uptime_percent;

ALTER TABLE proxy_listings
    DROP COLUMN IF EXISTS uptime_percent;

-- Rollback DB-05 marketplace browse indexes.

DROP INDEX IF EXISTS idx_proxy_listings_active_price;
DROP INDEX IF EXISTS idx_proxy_listings_active_uptime_latency;
DROP INDEX IF EXISTS idx_proxy_listings_active_latency;
DROP INDEX IF EXISTS idx_proxy_listings_active_isp_trgm;
DROP INDEX IF EXISTS idx_proxy_listings_status_country_lower;
DROP INDEX IF EXISTS idx_proxy_listings_status_country;

-- Leave pg_trgm installed — other migrations/extensions may depend on it.

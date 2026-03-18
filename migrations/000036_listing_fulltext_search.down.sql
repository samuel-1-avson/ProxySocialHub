-- E4: Rollback — drop FTS column and GIN index from proxy_listings.

DROP INDEX IF EXISTS idx_proxy_listings_search_vector;
ALTER TABLE proxy_listings DROP COLUMN IF EXISTS search_vector;

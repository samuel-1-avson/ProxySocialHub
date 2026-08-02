-- Phase E: drop leftover shadow browse indexes if present.
-- idx_proxy_listings_status_country already dropped in 000118; re-assert IF EXISTS.
-- Manual/docs ops indexes (idx_listing_search / idx_listing_country) may exist on some envs.

DROP INDEX IF EXISTS public.idx_proxy_listings_status_country;
DROP INDEX IF EXISTS public.idx_listing_search;
DROP INDEX IF EXISTS public.idx_listing_country;

-- Browse expects expression index from 000110:
-- idx_proxy_listings_status_country_lower ON (status, LOWER(country))
COMMENT ON INDEX public.idx_proxy_listings_status_country_lower IS
    'Canonical country browse: EXPLAIN should use this for LOWER(country) IN (...).';

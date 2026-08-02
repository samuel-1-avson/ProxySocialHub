-- DB-05: indexes for marketplace browse filters/sorts in
-- services/control-api/internal/marketplace/discovery/query.go
-- (status = active + country / ISP / latency / uptime).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Country equality (LOWER(country) = LOWER(?)) and multi-country IN lists.
CREATE INDEX IF NOT EXISTS idx_proxy_listings_status_country
    ON public.proxy_listings (status, country);

CREATE INDEX IF NOT EXISTS idx_proxy_listings_status_country_lower
    ON public.proxy_listings (status, LOWER(country));

-- ISP substring filter: isp ILIKE '%…%'
CREATE INDEX IF NOT EXISTS idx_proxy_listings_active_isp_trgm
    ON public.proxy_listings USING GIN (isp gin_trgm_ops)
    WHERE status = 'active' AND isp IS NOT NULL AND isp <> '';

-- Sort: latency (avg_latency_ms ASC, uptime_percent DESC)
CREATE INDEX IF NOT EXISTS idx_proxy_listings_active_latency
    ON public.proxy_listings (avg_latency_ms ASC, uptime_percent DESC, created_at DESC)
    WHERE status = 'active';

-- Sort: uptime (uptime_percent, avg_latency_ms)
CREATE INDEX IF NOT EXISTS idx_proxy_listings_active_uptime_latency
    ON public.proxy_listings (uptime_percent DESC, avg_latency_ms ASC, created_at DESC)
    WHERE status = 'active';

-- Sort: price (common browse path)
CREATE INDEX IF NOT EXISTS idx_proxy_listings_active_price
    ON public.proxy_listings (price_per_gb ASC, created_at DESC)
    WHERE status = 'active';

COMMENT ON INDEX idx_proxy_listings_status_country IS
'DB-05: browse filter status + country';
COMMENT ON INDEX idx_proxy_listings_active_isp_trgm IS
'DB-05: browse ISP ILIKE via pg_trgm (active listings)';
COMMENT ON INDEX idx_proxy_listings_active_latency IS
'DB-05: browse sort by latency';

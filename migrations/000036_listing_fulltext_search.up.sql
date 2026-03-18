-- E4: Full-text search for proxy_listings.
-- Adds a generated tsvector column and a GIN index so marketplace search
-- queries can use PostgreSQL FTS instead of ILIKE scans.
--
-- The generated column is automatically kept up to date by PostgreSQL on
-- INSERT / UPDATE — no application code changes are required.
-- Query example: WHERE search_vector @@ plainto_tsquery('english', $1)

ALTER TABLE proxy_listings
    ADD COLUMN IF NOT EXISTS search_vector tsvector
        GENERATED ALWAYS AS (
            setweight(to_tsvector('english', coalesce(title, '')),       'A') ||
            setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
            setweight(to_tsvector('english', coalesce(country, '')),     'C') ||
            setweight(to_tsvector('english', coalesce(isp, '')),         'C') ||
            setweight(to_tsvector('english', coalesce(proxy_type, '')),  'D')
        ) STORED;

-- GIN index for fast FTS lookups
CREATE INDEX IF NOT EXISTS idx_proxy_listings_search_vector
    ON proxy_listings USING GIN (search_vector);

COMMENT ON COLUMN proxy_listings.search_vector IS
    'Auto-generated FTS vector: title(A) > description(B) > country/isp(C) > proxy_type(D). '
    'Query with: WHERE search_vector @@ plainto_tsquery(''english'', $1)';

-- Ensure legacy schemas expose proxy_listings.uptime_percent expected by runtime code.
ALTER TABLE proxy_listings
    ADD COLUMN IF NOT EXISTS uptime_percent NUMERIC(5,2);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'proxy_listings'
          AND column_name = 'uptime_percentage'
    ) THEN
        EXECUTE '
            UPDATE proxy_listings
               SET uptime_percent = COALESCE(uptime_percent, uptime_percentage, 100)
        ';
    ELSE
        EXECUTE '
            UPDATE proxy_listings
               SET uptime_percent = COALESCE(uptime_percent, 100)
        ';
    END IF;
END $$;

ALTER TABLE proxy_listings
    ALTER COLUMN uptime_percent SET DEFAULT 100,
    ALTER COLUMN uptime_percent SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_proxy_listings_uptime_percent
    ON proxy_listings (uptime_percent);

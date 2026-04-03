-- Ensure legacy schemas expose proxy_listings.current_tier expected by runtime code.
ALTER TABLE proxy_listings
    ADD COLUMN IF NOT EXISTS current_tier VARCHAR(20);

UPDATE proxy_listings
   SET current_tier = COALESCE(NULLIF(current_tier, ''), 'Bronze');

ALTER TABLE proxy_listings
    ALTER COLUMN current_tier SET DEFAULT 'Bronze',
    ALTER COLUMN current_tier SET NOT NULL;

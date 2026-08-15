DROP INDEX IF EXISTS idx_proxy_listings_commitment_on_chain;

ALTER TABLE proxy_listings
    DROP COLUMN IF EXISTS listing_commitment_at,
    DROP COLUMN IF EXISTS listing_commitment_tx,
    DROP COLUMN IF EXISTS listing_commitment_on_chain,
    DROP COLUMN IF EXISTS listing_commitment_pda;

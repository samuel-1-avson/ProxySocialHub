-- Wave 5.C.5 — listing commitment PDA mirror columns (not full on-chain catalog)
ALTER TABLE proxy_listings
    ADD COLUMN IF NOT EXISTS listing_commitment_pda VARCHAR(64) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS listing_commitment_on_chain BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS listing_commitment_tx VARCHAR(128) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS listing_commitment_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_proxy_listings_commitment_on_chain
    ON proxy_listings (listing_commitment_on_chain)
    WHERE listing_commitment_on_chain = TRUE;

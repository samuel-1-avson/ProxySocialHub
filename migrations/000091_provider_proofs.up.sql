-- Provider-authored proof metadata for decentralization Phase 1.

ALTER TABLE provider_nodes
    ADD COLUMN IF NOT EXISTS latest_heartbeat_hash VARCHAR(64),
    ADD COLUMN IF NOT EXISTS latest_heartbeat_signature TEXT,
    ADD COLUMN IF NOT EXISTS latest_heartbeat_signer VARCHAR(64),
    ADD COLUMN IF NOT EXISTS latest_heartbeat_signed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS latest_heartbeat_verified BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS latest_heartbeat_verification_error TEXT,
    ADD COLUMN IF NOT EXISTS latest_heartbeat_nonce VARCHAR(128);

CREATE INDEX IF NOT EXISTS idx_provider_nodes_heartbeat_signer
    ON provider_nodes (latest_heartbeat_signer);

ALTER TABLE proxy_listings
    ADD COLUMN IF NOT EXISTS listing_offer_hash VARCHAR(64),
    ADD COLUMN IF NOT EXISTS listing_offer_signature TEXT,
    ADD COLUMN IF NOT EXISTS listing_offer_signer VARCHAR(64),
    ADD COLUMN IF NOT EXISTS listing_offer_signed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS listing_offer_verified BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS listing_offer_verification_error TEXT,
    ADD COLUMN IF NOT EXISTS listing_offer_nonce VARCHAR(128);

CREATE INDEX IF NOT EXISTS idx_proxy_listings_offer_signer
    ON proxy_listings (listing_offer_signer);

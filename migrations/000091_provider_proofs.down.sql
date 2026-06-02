DROP INDEX IF EXISTS idx_proxy_listings_offer_signer;
DROP INDEX IF EXISTS idx_provider_nodes_heartbeat_signer;

ALTER TABLE proxy_listings
    DROP COLUMN IF EXISTS listing_offer_nonce,
    DROP COLUMN IF EXISTS listing_offer_verification_error,
    DROP COLUMN IF EXISTS listing_offer_verified,
    DROP COLUMN IF EXISTS listing_offer_signed_at,
    DROP COLUMN IF EXISTS listing_offer_signer,
    DROP COLUMN IF EXISTS listing_offer_signature,
    DROP COLUMN IF EXISTS listing_offer_hash;

ALTER TABLE provider_nodes
    DROP COLUMN IF EXISTS latest_heartbeat_nonce,
    DROP COLUMN IF EXISTS latest_heartbeat_verification_error,
    DROP COLUMN IF EXISTS latest_heartbeat_verified,
    DROP COLUMN IF EXISTS latest_heartbeat_signed_at,
    DROP COLUMN IF EXISTS latest_heartbeat_signer,
    DROP COLUMN IF EXISTS latest_heartbeat_signature,
    DROP COLUMN IF EXISTS latest_heartbeat_hash;

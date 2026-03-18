-- Down: cannot restore revoked tokens — the old SHA-256 hashes are no longer
-- verifiable after TOKEN_HMAC_SECRET is set. This migration is irreversible.
-- Providers must re-generate their tokens.
SELECT 1; -- no-op

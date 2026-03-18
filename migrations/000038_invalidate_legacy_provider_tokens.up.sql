-- Migration: 000038_invalidate_legacy_provider_tokens
--
-- Context:
--   Provider tokens were previously hashed with plain SHA-256 (no key).
--   They are now hashed with HMAC-SHA256 keyed by TOKEN_HMAC_SECRET.
--
--   Since the hash format has changed, all existing token hashes in the DB
--   are now invalid — the server can no longer verify them. We revoke them
--   all here so providers get a clear "invalid token" error rather than
--   silent auth failure, and are prompted to generate a new token.
--
-- Impact:
--   All providers must generate a new CLI token from the dashboard after
--   this migration runs. Their nodes will go offline until they do.
--   Notify providers via the notifications system before deploying.

UPDATE provider_tokens
SET
    is_active  = false,
    updated_at = NOW()
WHERE
    is_active = true
    AND deleted_at IS NULL;

-- Record count for audit
DO $$
DECLARE
    revoked_count INT;
BEGIN
    GET DIAGNOSTICS revoked_count = ROW_COUNT;
    RAISE NOTICE 'Token migration 000038: revoked % active tokens (hash format change)', revoked_count;
END $$;

-- Drop oauth_identities table
DROP TABLE IF EXISTS oauth_identities;

-- Make password_hash NOT NULL again (WARNING: This might fail if there are OAuth-only users)
-- We will attempt to set a placeholder for existing null passwords if we were to strictly reverse it,
-- but strictly speaking, we can't easily restore the constraint if data violates it.
-- For now, we will just try to add the constraint back.
-- Ideally, we'd delete users with null passwords or handle them, but for dev rewind:
DELETE FROM users WHERE password_hash IS NULL;
ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;

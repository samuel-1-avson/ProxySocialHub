-- Rollback changes storage only. Deploying an older auth implementation would
-- restore the audited security defects; this is not a safe security rollback.
DROP TABLE IF EXISTS auth_mfa_challenges;
DROP INDEX IF EXISTS idx_user_session_family;
ALTER TABLE user_settings DROP COLUMN IF EXISTS last_totp_hash, DROP COLUMN IF EXISTS last_totp_at;
ALTER TABLE profiles DROP COLUMN IF EXISTS profile_public, DROP COLUMN IF EXISTS discoverable,
    DROP COLUMN IF EXISTS map_visible, DROP COLUMN IF EXISTS map_precision,
    DROP COLUMN IF EXISTS presence_visible, DROP COLUMN IF EXISTS activity_public,
    DROP COLUMN IF EXISTS contact_mode, DROP COLUMN IF EXISTS analytics_opt_in,
    DROP COLUMN IF EXISTS allow_direct_connections, DROP COLUMN IF EXISTS public_chain_consent,
    DROP COLUMN IF EXISTS privacy_updated_at;

ALTER TABLE proxy_listings ALTER COLUMN allow_direct_message SET DEFAULT true;

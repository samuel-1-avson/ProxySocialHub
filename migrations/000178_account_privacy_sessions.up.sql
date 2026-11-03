ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS profile_public boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS discoverable boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS map_visible boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS map_precision text NOT NULL DEFAULT 'country' CHECK (map_precision IN ('country', 'city')),
    ADD COLUMN IF NOT EXISTS presence_visible boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS activity_public boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS contact_mode text NOT NULL DEFAULT 'contacts' CHECK (contact_mode IN ('nobody', 'contacts', 'inquiries', 'everyone')),
    ADD COLUMN IF NOT EXISTS analytics_opt_in boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS allow_direct_connections boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS public_chain_consent boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS privacy_updated_at timestamptz;

-- Existing users receive the same private defaults; public disclosure needs consent.
-- Do not rewrite existing aliases or publish previously private metadata.
CREATE INDEX IF NOT EXISTS idx_user_session_family ON user_sessions(token_family);
ALTER TABLE user_settings ALTER COLUMN two_factor_secret TYPE text;
ALTER TABLE user_settings
    ADD COLUMN IF NOT EXISTS last_totp_hash text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS last_totp_at timestamptz;

CREATE TABLE IF NOT EXISTS auth_mfa_challenges (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    attempts integer NOT NULL DEFAULT 0,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auth_mfa_expiry ON auth_mfa_challenges(expires_at);

-- Public topology is a disposable read model; rebuild only from consented inputs.
DELETE FROM map_node_links;

ALTER TABLE proxy_listings ADD COLUMN IF NOT EXISTS allow_direct_message BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE proxy_listings ALTER COLUMN allow_direct_message SET DEFAULT false;
UPDATE proxy_listings SET allow_direct_message = false;

-- Replace only the exact legacy generated wallet alias; preserve chosen aliases.
UPDATE profiles SET username = 'user_' || replace(uuid_generate_v4()::text,'-','') WHERE wallet_address IS NOT NULL AND username = 'user_' || substring(wallet_address from 1 for 8);

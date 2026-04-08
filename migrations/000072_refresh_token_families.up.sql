CREATE TABLE IF NOT EXISTS refresh_token_families (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    family_id VARCHAR(64) NOT NULL,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    token_id VARCHAR(64) NOT NULL,
    token_hash VARCHAR(128) NOT NULL UNIQUE,
    parent_token_id VARCHAR(64),
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    is_current BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_refresh_token_families_user_id ON refresh_token_families (user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_token_families_family_id ON refresh_token_families (family_id);
CREATE INDEX IF NOT EXISTS idx_refresh_token_families_is_current ON refresh_token_families (is_current);
CREATE INDEX IF NOT EXISTS idx_refresh_token_families_revoked_at ON refresh_token_families (revoked_at);
-- 000081_user_flags.up.sql
CREATE TABLE IF NOT EXISTS user_flags (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    flag_type VARCHAR(50) NOT NULL,
    reason TEXT,
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_flags_user_id ON user_flags(user_id);

-- Migration: Create API Keys table
-- Version: 000004
-- Description: API key management for programmatic access

-- Create API keys table
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    key_hash VARCHAR(64) NOT NULL,           -- SHA-256 hash of actual key
    key_prefix VARCHAR(12) NOT NULL,         -- First 12 chars for display: "pk_abc123..."
    permissions JSONB DEFAULT '["read", "proxy"]',
    rate_limit_per_minute INT DEFAULT 100,
    last_used_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,     -- NULL = never expires
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    revoked_at TIMESTAMP WITH TIME ZONE      -- NULL = active
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_prefix ON api_keys(key_prefix);

-- Comments
COMMENT ON TABLE api_keys IS 'API keys for programmatic access to the proxy service';
COMMENT ON COLUMN api_keys.key_hash IS 'SHA-256 hash of the actual API key - original key is only shown once';
COMMENT ON COLUMN api_keys.key_prefix IS 'First 12 characters of key for display identification';
COMMENT ON COLUMN api_keys.permissions IS 'JSON array of permissions: read, write, proxy, admin';
COMMENT ON COLUMN api_keys.revoked_at IS 'If set, the key is revoked and cannot be used';

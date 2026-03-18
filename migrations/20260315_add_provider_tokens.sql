-- Migration: Add provider token and CLI distribution tables
-- Date: 2026-03-15
-- Note: Removed FK constraints to allow flexible user storage (Supabase/DB)

-- Provider Tokens table
CREATE TABLE IF NOT EXISTS provider_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    token VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(100),
    last_used TIMESTAMP,
    expires_at TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_provider_tokens_user_id ON provider_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_provider_tokens_token ON provider_tokens(token);
CREATE INDEX IF NOT EXISTS idx_provider_tokens_deleted_at ON provider_tokens(deleted_at);

-- CLI Downloads table
CREATE TABLE IF NOT EXISTS cli_downloads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    version VARCHAR(20) NOT NULL,
    platform VARCHAR(20) NOT NULL,
    arch VARCHAR(20) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_size BIGINT NOT NULL,
    checksum VARCHAR(64),
    download_url VARCHAR(500),
    is_latest BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cli_downloads_platform_arch ON cli_downloads(platform, arch);
CREATE INDEX IF NOT EXISTS idx_cli_downloads_latest ON cli_downloads(is_latest) WHERE is_latest = true;
CREATE INDEX IF NOT EXISTS idx_cli_downloads_active ON cli_downloads(is_active) WHERE is_active = true;

-- Provider Node Registrations table
CREATE TABLE IF NOT EXISTS provider_node_registrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    token_id UUID NOT NULL,
    node_id UUID NOT NULL,
    ip_address VARCHAR(45),
    hostname VARCHAR(100),
    cli_version VARCHAR(20),
    first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_provider_node_registrations_user_id ON provider_node_registrations(user_id);
CREATE INDEX IF NOT EXISTS idx_provider_node_registrations_token_id ON provider_node_registrations(token_id);
CREATE INDEX IF NOT EXISTS idx_provider_node_registrations_node_id ON provider_node_registrations(node_id);

-- Add comment to explain the tables
COMMENT ON TABLE provider_tokens IS 'Access tokens for Provider CLI authentication';
COMMENT ON TABLE cli_downloads IS 'CLI binary distribution information';
COMMENT ON TABLE provider_node_registrations IS 'Links CLI tokens to registered nodes';

-- Migration: Add Two-Factor Authentication fields to users table
-- Version: 000003
-- Description: Add TOTP 2FA support with backup codes

-- Add 2FA fields to users table (if not already added via GORM migration)
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(64),
ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN DEFAULT FALSE;

-- Create backup codes table
CREATE TABLE IF NOT EXISTS totp_backup_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash VARCHAR(255) NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for quick lookup
CREATE INDEX IF NOT EXISTS idx_totp_backup_codes_user_id ON totp_backup_codes(user_id);

-- Comment
COMMENT ON COLUMN users.totp_secret IS 'Encrypted TOTP secret for 2FA';
COMMENT ON COLUMN users.totp_enabled IS 'Whether 2FA is enabled for this user';

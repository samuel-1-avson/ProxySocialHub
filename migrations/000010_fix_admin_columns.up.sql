-- Migration: Fix missing admin columns
-- Created: March 10, 2026

-- ============================================
-- Add status column to profiles table
-- ============================================
ALTER TABLE profiles 
    ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'pending', 'suspended', 'banned'));

-- Create index for status queries
CREATE INDEX IF NOT EXISTS idx_profiles_status ON profiles(status);

-- ============================================
-- Create account_lockouts table
-- ============================================
CREATE TABLE IF NOT EXISTS account_lockouts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Account identifier (email, IP, or wallet)
    identifier VARCHAR(255) NOT NULL,
    identifier_type VARCHAR(20) NOT NULL DEFAULT 'email' CHECK (identifier_type IN ('email', 'ip', 'wallet')),
    
    -- Lockout tracking
    failed_attempts INT DEFAULT 0,
    locked_at TIMESTAMPTZ,
    locked_until TIMESTAMPTZ,  -- When the lockout expires (used by queries)
    unlocked_at TIMESTAMPTZ,
    lock_reason VARCHAR(100),
    
    -- Auto-unlock for progressive lockouts
    auto_unlock_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for account lockout queries
CREATE INDEX IF NOT EXISTS idx_account_lockouts_identifier ON account_lockouts(identifier);
CREATE INDEX IF NOT EXISTS idx_account_lockouts_locked_until ON account_lockouts(locked_until) WHERE locked_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_account_lockouts_locked_at ON account_lockouts(locked_at) WHERE locked_at IS NOT NULL;

-- ============================================
-- Create user_settings table if not exists
-- ============================================
CREATE TABLE IF NOT EXISTS user_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    
    -- MFA/TOTP Settings
    two_factor_enabled BOOLEAN DEFAULT FALSE,
    two_factor_secret VARCHAR(64),
    two_factor_backup_codes TEXT,
    two_factor_verified_at TIMESTAMPTZ,
    
    -- Session Settings
    session_timeout INT DEFAULT 1440,
    max_concurrent_sessions INT DEFAULT 5,
    allowed_ip_ranges TEXT,
    
    -- Notification Settings
    notify_on_new_login BOOLEAN DEFAULT TRUE,
    notify_on_password_change BOOLEAN DEFAULT TRUE,
    notify_on_new_session BOOLEAN DEFAULT FALSE,
    
    -- Preferences
    preferred_language VARCHAR(10) DEFAULT 'en',
    theme VARCHAR(20) DEFAULT 'system',
    timezone VARCHAR(50) DEFAULT 'UTC',
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);

-- ============================================
-- Create user_sessions table if not exists
-- ============================================
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    
    -- Token info
    refresh_token VARCHAR(255) UNIQUE,
    token_family VARCHAR(64),
    
    -- Fingerprint
    ip_address VARCHAR(45) NOT NULL,
    user_agent TEXT,
    fingerprint VARCHAR(64),
    
    -- Geolocation
    country VARCHAR(2),
    city VARCHAR(100),
    
    -- Device info
    device_type VARCHAR(20),
    browser VARCHAR(50),
    os VARCHAR(50),
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    revoked_at TIMESTAMPTZ,
    revoke_reason VARCHAR(100),
    
    -- Timing
    last_active_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(refresh_token);
CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(user_id, is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);

-- ============================================
-- Create login_attempts table if not exists
-- ============================================
CREATE TABLE IF NOT EXISTS login_attempts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    identifier VARCHAR(255) NOT NULL,
    identifier_type VARCHAR(20) NOT NULL DEFAULT 'email',
    
    success BOOLEAN DEFAULT FALSE,
    failure_reason VARCHAR(100),
    
    ip_address VARCHAR(45) NOT NULL,
    user_agent TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_identifier ON login_attempts(identifier);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip_address);
CREATE INDEX IF NOT EXISTS idx_login_attempts_created ON login_attempts(created_at);

-- ============================================
-- Create security_anomalies table if not exists
-- ============================================
CREATE TABLE IF NOT EXISTS security_anomalies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    
    anomaly_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    description TEXT,
    
    -- Context
    ip_address VARCHAR(45),
    user_agent TEXT,
    location VARCHAR(100),
    
    -- Resolution
    is_resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    resolution_notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_anomalies_user_id ON security_anomalies(user_id);
CREATE INDEX IF NOT EXISTS idx_security_anomalies_unresolved ON security_anomalies(is_resolved, created_at) WHERE is_resolved = FALSE;

-- ============================================
-- Update trigger for account_lockouts updated_at
-- ============================================
CREATE OR REPLACE FUNCTION update_account_lockouts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_account_lockouts_updated_at ON account_lockouts;
CREATE TRIGGER trg_account_lockouts_updated_at
    BEFORE UPDATE ON account_lockouts
    FOR EACH ROW
    EXECUTE FUNCTION update_account_lockouts_updated_at();

-- ============================================
-- Backfill existing users with active status
-- ============================================
UPDATE profiles SET status = 'active' WHERE status IS NULL;

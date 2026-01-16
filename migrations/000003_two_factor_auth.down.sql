-- Rollback: Remove Two-Factor Authentication fields
-- Version: 000003

-- Drop backup codes table
DROP TABLE IF EXISTS totp_backup_codes;

-- Remove 2FA columns
ALTER TABLE users 
DROP COLUMN IF EXISTS totp_secret,
DROP COLUMN IF EXISTS totp_enabled;

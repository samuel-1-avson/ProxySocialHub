-- Rollback: Remove email verification fields from users table
-- Version: 000002

-- Remove index
DROP INDEX IF EXISTS idx_users_verification_token;

-- Remove columns
ALTER TABLE users 
DROP COLUMN IF EXISTS email_verified,
DROP COLUMN IF EXISTS verification_token,
DROP COLUMN IF EXISTS verification_token_expires;

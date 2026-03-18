DROP INDEX IF EXISTS idx_disputes_expires_at;
ALTER TABLE disputes DROP COLUMN IF EXISTS expires_at;

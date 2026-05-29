-- 000080_withdrawal_security.up.sql
-- Add columns for withdrawal security: whitelist, primary withdrawal address, and address change cooldown timestamp.
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS withdrawal_whitelist JSONB DEFAULT '[]';
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS primary_withdrawal_address VARCHAR(44);
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS withdrawal_address_changed_at TIMESTAMPTZ;

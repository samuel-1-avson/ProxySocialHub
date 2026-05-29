-- 000080_withdrawal_security.down.sql
ALTER TABLE wallets DROP COLUMN IF EXISTS withdrawal_whitelist;
ALTER TABLE wallets DROP COLUMN IF EXISTS primary_withdrawal_address;
ALTER TABLE wallets DROP COLUMN IF EXISTS withdrawal_address_changed_at;

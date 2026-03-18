-- P2-17: Add limits_enabled flag so "0" means "zero allowed" (not "unlimited").
-- Existing wallets that already have non-zero limits are migrated to enabled=true.
ALTER TABLE wallets
    ADD COLUMN IF NOT EXISTS limits_enabled BOOLEAN NOT NULL DEFAULT false;

-- Activate limits for any wallet that already has a non-zero limit configured.
UPDATE wallets
    SET limits_enabled = true
    WHERE daily_limit > 0 OR weekly_limit > 0 OR monthly_limit > 0;

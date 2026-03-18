-- Migration: Remove Spending Limits Feature (Rollback)
-- Description: Removes spending limit tracking from wallets and spending records table
-- Created: 2026-03-14

-- 1. Drop spending records table
DROP TABLE IF EXISTS spending_records;

-- 2. Remove spending limit columns from wallets
ALTER TABLE wallets 
    DROP COLUMN IF EXISTS daily_limit,
    DROP COLUMN IF EXISTS weekly_limit,
    DROP COLUMN IF EXISTS monthly_limit,
    DROP COLUMN IF EXISTS limit_window_start;

-- Add migration tracking
INSERT INTO schema_migrations (version, description) 
VALUES (28, 'Rollback: Remove spending limits feature');

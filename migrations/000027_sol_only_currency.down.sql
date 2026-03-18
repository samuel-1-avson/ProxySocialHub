-- Migration: SOL-Only Currency System (Rollback)
-- Description: Restore multi-currency support (GHS, USDT)
-- Created: 2026-03-14

-- Note: This rollback is destructive - data in balance_ghs and balance_usdt 
-- cannot be recovered if the migration has been run.
-- Use with caution and ensure backups exist.

-- 1. Restore columns to wallets table
ALTER TABLE wallets 
    ADD COLUMN IF NOT EXISTS balance_ghs DECIMAL(20,4) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS balance_usdt DECIMAL(20,4) DEFAULT 0;

-- 2. Restore currency column default
ALTER TABLE wallets 
    ALTER COLUMN currency SET DEFAULT 'MULTI';

-- 3. Restore pending_transactions columns
ALTER TABLE pending_transactions 
    ALTER COLUMN amount TYPE DECIMAL(20,4),
    ALTER COLUMN currency SET DEFAULT 'GHS';

-- 4. Restore wallet_ledger_entries precision
ALTER TABLE wallet_ledger_entries 
    ALTER COLUMN amount TYPE DECIMAL(20,4),
    ALTER COLUMN balance_after TYPE DECIMAL(20,4);

-- Add migration tracking
INSERT INTO schema_migrations (version, description) 
VALUES (27, 'Rollback: Restore multi-currency support (GHS, USDT)');

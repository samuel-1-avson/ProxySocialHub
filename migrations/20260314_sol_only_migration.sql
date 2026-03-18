-- Migration: SOL-Only Currency System
-- Date: March 14, 2026
-- Description: Remove USDC, USDT, and GHS support, keeping only SOL

-- Step 1: Backup existing balances (for reconciliation)
CREATE TABLE IF NOT EXISTS wallet_backup_20260314 AS
SELECT 
    id, 
    user_id, 
    balance_sol,
    balance_ghs,
    balance_usdt,
    currency,
    created_at,
    updated_at
FROM wallets;

-- Step 2: Convert any GHS/USDT balances to SOL equivalent and add to balance_sol
-- Note: This assumes SOL price of ~$200, GHS rate of ~11 per USD
-- Adjust the conversion rate as needed
UPDATE wallets 
SET balance_sol = balance_sol + 
    (COALESCE(balance_ghs, 0) / 2200.0) +  -- GHS to SOL (2200 GHS = ~1 SOL)
    (COALESCE(balance_usdt, 0) / 200.0),   -- USDT to SOL ($200 = ~1 SOL)
    updated_at = NOW();

-- Step 3: Remove multi-currency columns
ALTER TABLE wallets 
    DROP COLUMN IF EXISTS balance_ghs,
    DROP COLUMN IF EXISTS balance_usdt,
    DROP COLUMN IF EXISTS currency;

-- Step 4: Ensure balance_sol has proper defaults
ALTER TABLE wallets 
    ALTER COLUMN balance_sol SET DEFAULT 0,
    ALTER COLUMN balance_sol SET NOT NULL;

-- Step 5: Update pending_transactions to use SOL only
ALTER TABLE pending_transactions 
    ALTER COLUMN currency SET DEFAULT 'SOL';

UPDATE pending_transactions 
SET currency = 'SOL' 
WHERE currency IN ('GHS', 'USDC', 'USDT', 'MULTI');

-- Step 6: Update wallet_ledger_entries currency references
UPDATE wallet_ledger_entries
SET type = 'sol_' || type
WHERE type IN ('topup', 'usage', 'payout', 'refund', 'earning')
  AND NOT type LIKE 'sol_%';

-- Step 7: Create index on balance_sol for performance
CREATE INDEX IF NOT EXISTS idx_wallets_balance_sol ON wallets(balance_sol);

-- Step 8: Add comment to document the change
COMMENT ON TABLE wallets IS 'User wallets - SOL-only currency system';

-- Verification queries
-- SELECT COUNT(*) as total_wallets FROM wallets;
-- SELECT AVG(balance_sol) as avg_balance FROM wallets;
-- SELECT MAX(balance_sol) as max_balance FROM wallets;

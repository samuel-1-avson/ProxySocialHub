-- Up Migration: Wallet Security & Database Schema Remediation
-- Description: Hardens database layer constraints and fixes baseline index column name mismatch.

-- 1. Add UNIQUE constraint on wallet_ledger_entries.tx_hash (Fix C1)
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_ledger_tx_hash 
ON wallet_ledger_entries (tx_hash) 
WHERE tx_hash IS NOT NULL AND tx_hash <> '';

-- 2. Change wallets.limits_enabled default to true (Fix 2.1)
ALTER TABLE wallets ALTER COLUMN limits_enabled SET DEFAULT true;
UPDATE wallets SET limits_enabled = true WHERE limits_enabled IS NULL;

-- 3. Fix provider_earnings column and index name mismatch (Fix 2.5)
DO $$ 
BEGIN 
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'provider_earnings' AND column_name = 'provider_id'
    ) THEN 
        ALTER TABLE provider_earnings RENAME COLUMN provider_id TO provider_user_id; 
    END IF; 
END $$;

CREATE INDEX IF NOT EXISTS idx_provider_earnings_provider_user_id 
ON provider_earnings (provider_user_id);

DROP INDEX IF EXISTS idx_provider_earnings_provider_id;

-- 4. Add UNIQUE constraint on spending_records (Fix 3.9)
CREATE UNIQUE INDEX IF NOT EXISTS idx_spending_records_wallet_ref_type 
ON spending_records (wallet_id, reference, type) 
WHERE reference IS NOT NULL AND reference <> '';

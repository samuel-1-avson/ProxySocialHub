-- Down Migration: Wallet Security & Database Schema Remediation

DROP INDEX IF EXISTS idx_wallet_ledger_tx_hash;

ALTER TABLE wallets ALTER COLUMN limits_enabled SET DEFAULT false;

DROP INDEX IF EXISTS idx_provider_earnings_provider_user_id;

DROP INDEX IF EXISTS idx_spending_records_wallet_ref_type;

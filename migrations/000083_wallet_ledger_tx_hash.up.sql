-- GORM model WalletLedgerEntry.TxHash was added without a DB column (deposit API returned 500).
ALTER TABLE public.wallet_ledger_entries
    ADD COLUMN IF NOT EXISTS tx_hash VARCHAR(255);

COMMENT ON COLUMN public.wallet_ledger_entries.tx_hash IS 'On-chain transaction signature (duplicate of reference_id when set)';

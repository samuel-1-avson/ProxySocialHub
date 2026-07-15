-- Re-create duplicate and redundant indexes on explorer_transactions for rollback
CREATE INDEX IF NOT EXISTS idx_explorer_tx_from_address ON explorer_transactions (from_address);
CREATE INDEX IF NOT EXISTS idx_explorer_tx_to_address   ON explorer_transactions (to_address);
CREATE INDEX IF NOT EXISTS idx_explorer_tx_status       ON explorer_transactions (status);
CREATE INDEX IF NOT EXISTS idx_explorer_tx_chain        ON explorer_transactions (chain);

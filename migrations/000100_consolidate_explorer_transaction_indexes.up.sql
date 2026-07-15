-- P3-14: Drop duplicate and redundant indexes on explorer_transactions to reclaim space and speed up writes
-- 1. Drop duplicate indexes created on exact same columns
DROP INDEX IF EXISTS idx_explorer_tx_from_address;
DROP INDEX IF EXISTS idx_explorer_tx_to_address;

-- 2. Drop low-cardinality status and chain indexes which have zero scans
DROP INDEX IF EXISTS idx_explorer_tx_status;
DROP INDEX IF EXISTS idx_explorer_tx_chain;

-- Revert P1-01 explorer index migration
DROP INDEX IF EXISTS idx_explorer_tx_block_number;
DROP INDEX IF EXISTS idx_explorer_tx_from_address;
DROP INDEX IF EXISTS idx_explorer_tx_to_address;
DROP INDEX IF EXISTS idx_explorer_tx_status;
DROP INDEX IF EXISTS idx_explorer_tx_timestamp;
DROP INDEX IF EXISTS idx_explorer_nodes_is_active;
DROP INDEX IF EXISTS idx_explorer_nodes_country;
DROP INDEX IF EXISTS idx_explorer_nodes_last_heartbeat;
DROP INDEX IF EXISTS idx_explorer_blocks_number;
DROP INDEX IF EXISTS idx_explorer_blocks_timestamp;

-- P1-01: Add missing indexes on explorer tables to support the high-frequency
-- queries used by the WebSocket broadcaster and API list endpoints.

-- explorer_transactions: lookups by block number, address, and status
CREATE INDEX IF NOT EXISTS idx_explorer_tx_block_number
    ON explorer_transactions (block_number DESC);

CREATE INDEX IF NOT EXISTS idx_explorer_tx_from_address
    ON explorer_transactions (from_address);

CREATE INDEX IF NOT EXISTS idx_explorer_tx_to_address
    ON explorer_transactions (to_address);

CREATE INDEX IF NOT EXISTS idx_explorer_tx_status
    ON explorer_transactions (status);

CREATE INDEX IF NOT EXISTS idx_explorer_tx_timestamp
    ON explorer_transactions (timestamp DESC);

-- explorer_nodes: active-node lookups and geo filtering
CREATE INDEX IF NOT EXISTS idx_explorer_nodes_is_active
    ON explorer_nodes (is_active);

CREATE INDEX IF NOT EXISTS idx_explorer_nodes_country
    ON explorer_nodes (country);

CREATE INDEX IF NOT EXISTS idx_explorer_nodes_last_heartbeat
    ON explorer_nodes (last_heartbeat DESC);

-- explorer_blocks: block number is the primary lookup key
CREATE INDEX IF NOT EXISTS idx_explorer_blocks_number
    ON explorer_blocks (block_number DESC);

CREATE INDEX IF NOT EXISTS idx_explorer_blocks_timestamp
    ON explorer_blocks (timestamp DESC);

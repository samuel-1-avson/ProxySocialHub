-- Partial indexes for explorer list/WS queries that always filter is_orphaned = false.

CREATE INDEX IF NOT EXISTS idx_explorer_tx_not_orphan_ts
    ON explorer_transactions (timestamp DESC)
    WHERE is_orphaned = false;

CREATE INDEX IF NOT EXISTS idx_explorer_tx_not_orphan_from
    ON explorer_transactions (from_address)
    WHERE is_orphaned = false;

CREATE INDEX IF NOT EXISTS idx_explorer_tx_not_orphan_to
    ON explorer_transactions (to_address)
    WHERE is_orphaned = false;

CREATE INDEX IF NOT EXISTS idx_explorer_blocks_not_orphan_num
    ON explorer_blocks (block_number DESC)
    WHERE is_orphaned = false;

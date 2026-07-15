-- Rollback partitioning of explorer_transactions table and restore standard table structure

-- 1. Rename partitioned table
ALTER TABLE explorer_transactions RENAME TO explorer_transactions_partitioned;

-- 2. Re-create the standard table
CREATE TABLE explorer_transactions (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tx_hash       VARCHAR(128) UNIQUE,
    chain         VARCHAR(20) DEFAULT 'solana',
    block_hash    VARCHAR(128),
    block_number  BIGINT,
    from_address  VARCHAR(128),
    to_address    VARCHAR(128),
    amount        NUMERIC,
    currency      VARCHAR(20) DEFAULT 'SOL',
    token_mint    VARCHAR(128) NOT NULL DEFAULT '',
    is_orphaned   BOOLEAN NOT NULL DEFAULT FALSE,
    fee           NUMERIC,
    status        VARCHAR(20),
    tx_type       VARCHAR(50),
    program_id    VARCHAR(128),
    timestamp     TIMESTAMPTZ,
    confirmations INT DEFAULT 0,
    raw_data      TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Copy all data back from partitioned table
INSERT INTO explorer_transactions (
    id, tx_hash, chain, block_hash, block_number, from_address, to_address,
    amount, currency, token_mint, is_orphaned, fee, status, tx_type, program_id,
    timestamp, confirmations, raw_data, created_at, updated_at
)
SELECT 
    id, tx_hash, chain, block_hash, block_number, from_address, to_address,
    amount, currency, token_mint, is_orphaned, fee, status, tx_type, program_id,
    timestamp, confirmations, raw_data, created_at, updated_at
FROM explorer_transactions_partitioned;

-- 4. Re-create all baseline indexes
CREATE INDEX IF NOT EXISTS idx_explorer_tx_block_number ON explorer_transactions (block_number DESC);
CREATE INDEX IF NOT EXISTS idx_explorer_tx_orphaned ON explorer_transactions (is_orphaned) WHERE is_orphaned = TRUE;
CREATE INDEX IF NOT EXISTS idx_explorer_tx_token_mint ON explorer_transactions (token_mint) WHERE token_mint != '';

-- Re-create partial active index optimizations
CREATE INDEX IF NOT EXISTS idx_explorer_tx_not_orphan_ts ON explorer_transactions (timestamp DESC, id DESC) WHERE is_orphaned = FALSE;
CREATE INDEX IF NOT EXISTS idx_explorer_tx_not_orphan_from ON explorer_transactions (from_address) WHERE is_orphaned = FALSE;
CREATE INDEX IF NOT EXISTS idx_explorer_tx_not_orphan_to ON explorer_transactions (to_address) WHERE is_orphaned = FALSE;

-- 5. Drop the partitioned table (automatically drops all partitions)
DROP TABLE explorer_transactions_partitioned;

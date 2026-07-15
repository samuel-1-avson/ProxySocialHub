-- Partition the explorer_transactions table by timestamp (monthly range partitioning)

-- 1. Rename existing table
ALTER TABLE explorer_transactions RENAME TO explorer_transactions_old;

-- 2. Create the new partitioned table (primary key must include timestamp partition key)
CREATE TABLE explorer_transactions (
    id            UUID DEFAULT uuid_generate_v4(),
    tx_hash       VARCHAR(128),
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
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

-- 3. Create partitions for recent and future months, plus a default partition
CREATE TABLE explorer_transactions_y2026m05 PARTITION OF explorer_transactions
    FOR VALUES FROM ('2026-05-01 00:00:00+00') TO ('2026-06-01 00:00:00+00');

CREATE TABLE explorer_transactions_y2026m06 PARTITION OF explorer_transactions
    FOR VALUES FROM ('2026-06-01 00:00:00+00') TO ('2026-07-01 00:00:00+00');

CREATE TABLE explorer_transactions_y2026m07 PARTITION OF explorer_transactions
    FOR VALUES FROM ('2026-07-01 00:00:00+00') TO ('2026-08-01 00:00:00+00');

CREATE TABLE explorer_transactions_y2026m08 PARTITION OF explorer_transactions
    FOR VALUES FROM ('2026-08-01 00:00:00+00') TO ('2026-09-01 00:00:00+00');

CREATE TABLE explorer_transactions_default PARTITION OF explorer_transactions DEFAULT;

-- 4. Copy existing data from old table to new partitioned table
INSERT INTO explorer_transactions (
    id, tx_hash, chain, block_hash, block_number, from_address, to_address,
    amount, currency, token_mint, is_orphaned, fee, status, tx_type, program_id,
    timestamp, confirmations, raw_data, created_at, updated_at
)
SELECT 
    id, tx_hash, chain, block_hash, block_number, from_address, to_address,
    amount, currency, token_mint, is_orphaned, fee, status, tx_type, program_id,
    timestamp, confirmations, raw_data, created_at, updated_at
FROM explorer_transactions_old;

-- 5. Create indexes on the parent partitioned table (Postgres propagates to all partitions)
CREATE UNIQUE INDEX IF NOT EXISTS idx_explorer_tx_hash_partitioned ON explorer_transactions (tx_hash, timestamp);
CREATE INDEX IF NOT EXISTS idx_explorer_tx_block_number_partitioned ON explorer_transactions (block_number DESC);
CREATE INDEX IF NOT EXISTS idx_explorer_tx_orphaned_partitioned ON explorer_transactions (is_orphaned) WHERE is_orphaned = TRUE;
CREATE INDEX IF NOT EXISTS idx_explorer_tx_token_mint_partitioned ON explorer_transactions (token_mint) WHERE token_mint != '';

-- Partial active index optimizations
CREATE INDEX IF NOT EXISTS idx_explorer_tx_not_orphan_ts_partitioned ON explorer_transactions (timestamp DESC, id DESC) WHERE is_orphaned = FALSE;
CREATE INDEX IF NOT EXISTS idx_explorer_tx_not_orphan_from_partitioned ON explorer_transactions (from_address) WHERE is_orphaned = FALSE;
CREATE INDEX IF NOT EXISTS idx_explorer_tx_not_orphan_to_partitioned ON explorer_transactions (to_address) WHERE is_orphaned = FALSE;

-- 6. Drop the old table to reclaim space
DROP TABLE explorer_transactions_old;

-- L2 Phase 4: ZK Batch settlement table and state channel on-chain fields.
-- Applied: 2026-04-01

-- ZK batch audit table: one row per Merkle-root commitment sent to Solana.
CREATE TABLE IF NOT EXISTS zk_batches (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_root      VARCHAR(64) NOT NULL,
    session_count   INTEGER NOT NULL DEFAULT 0,
    total_bytes     BIGINT NOT NULL DEFAULT 0,
    period_start    TIMESTAMPTZ NOT NULL,
    period_end      TIMESTAMPTZ NOT NULL,
    on_chain_tx_sig VARCHAR(88),
    on_chain_slot   BIGINT,
    proof_bytes     BYTEA,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_zk_batches_root
    ON zk_batches (batch_root);

CREATE INDEX IF NOT EXISTS idx_zk_batches_status
    ON zk_batches (status);

-- State channel: add on-chain PDA and TX signature columns.
ALTER TABLE state_channels
    ADD COLUMN IF NOT EXISTS onchain_pda    VARCHAR(44),
    ADD COLUMN IF NOT EXISTS onchain_tx_sig VARCHAR(88);

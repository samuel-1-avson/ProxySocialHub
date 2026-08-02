-- P2 MIG-02: promote zk_batches (skip state_channels — table not in root migrations).

CREATE TABLE IF NOT EXISTS public.zk_batches (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
    ON public.zk_batches (batch_root);

CREATE INDEX IF NOT EXISTS idx_zk_batches_status
    ON public.zk_batches (status);

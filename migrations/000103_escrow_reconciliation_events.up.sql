CREATE TABLE IF NOT EXISTS escrow_reconciliation_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source VARCHAR(64) NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    escrow_pda VARCHAR(64) NOT NULL,
    tx_signature VARCHAR(128) NOT NULL DEFAULT '',
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'unmatched',
    reason VARCHAR(128) NOT NULL DEFAULT '',
    last_error TEXT NOT NULL DEFAULT '',
    attempts INTEGER NOT NULL DEFAULT 1,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_escrow_reconciliation_source_event UNIQUE (source, event_type, escrow_pda, tx_signature)
);

CREATE INDEX IF NOT EXISTS idx_escrow_reconciliation_status_seen
    ON escrow_reconciliation_events (status, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_escrow_reconciliation_escrow_pda
    ON escrow_reconciliation_events (escrow_pda);

CREATE INDEX IF NOT EXISTS idx_escrow_reconciliation_order_id
    ON escrow_reconciliation_events (order_id)
    WHERE order_id IS NOT NULL;

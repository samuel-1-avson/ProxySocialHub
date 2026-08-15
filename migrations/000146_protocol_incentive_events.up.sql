-- Wave 4.3 — protocol incentive observe ledger (no mint)
CREATE TABLE IF NOT EXISTS protocol_incentive_events (
    id UUID PRIMARY KEY,
    session_id UUID,
    provider_user_id UUID,
    node_id UUID,
    event_type VARCHAR(64) NOT NULL DEFAULT 'settlement_split',
    mode VARCHAR(16) NOT NULL DEFAULT 'observe',
    status VARCHAR(32) NOT NULL DEFAULT 'observed',
    gross_amount_sol NUMERIC(20, 8) NOT NULL DEFAULT 0,
    protocol_fee_sol NUMERIC(20, 8) NOT NULL DEFAULT 0,
    provider_incentive_sol NUMERIC(20, 8) NOT NULL DEFAULT 0,
    gateway_incentive_sol NUMERIC(20, 8) NOT NULL DEFAULT 0,
    treasury_retain_sol NUMERIC(20, 8) NOT NULL DEFAULT 0,
    fee_bps INT NOT NULL DEFAULT 0,
    provider_share_bps INT NOT NULL DEFAULT 0,
    gateway_share_bps INT NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_protocol_incentive_session ON protocol_incentive_events (session_id);
CREATE INDEX IF NOT EXISTS idx_protocol_incentive_provider ON protocol_incentive_events (provider_user_id);
CREATE INDEX IF NOT EXISTS idx_protocol_incentive_created ON protocol_incentive_events (created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_protocol_incentive_session_type
    ON protocol_incentive_events (session_id, event_type)
    WHERE session_id IS NOT NULL;

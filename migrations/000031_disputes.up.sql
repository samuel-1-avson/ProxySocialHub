CREATE TABLE IF NOT EXISTS disputes (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id   UUID        NOT NULL,
    consumer_id  UUID        NOT NULL,
    provider_id  UUID        NOT NULL,
    node_id      UUID        NOT NULL,
    reason       VARCHAR(50) NOT NULL,
    description  TEXT,
    status       VARCHAR(20) NOT NULL DEFAULT 'open',
    resolution   TEXT,
    refund_sol   NUMERIC(20, 8) NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at  TIMESTAMPTZ,
    deleted_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_disputes_session    ON disputes(session_id);
CREATE INDEX IF NOT EXISTS idx_disputes_consumer   ON disputes(consumer_id);
CREATE INDEX IF NOT EXISTS idx_disputes_provider   ON disputes(provider_id);
CREATE INDEX IF NOT EXISTS idx_disputes_status     ON disputes(status);

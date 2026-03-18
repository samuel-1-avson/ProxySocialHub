-- P2-09: Persist reconciliation run results for historical queries.
CREATE TABLE IF NOT EXISTS reconciliation_history (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    treasury_balance_sol     DOUBLE PRECISION NOT NULL,
    internal_liabilities_sol DOUBLE PRECISION NOT NULL,
    discrepancy_sol          DOUBLE PRECISION NOT NULL,
    status                   VARCHAR(20)      NOT NULL,
    issues_json              JSONB            NOT NULL DEFAULT '[]',
    duration_ms              BIGINT           NOT NULL DEFAULT 0,
    created_at               TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_history_status     ON reconciliation_history (status);
CREATE INDEX IF NOT EXISTS idx_reconciliation_history_created_at ON reconciliation_history (created_at DESC);

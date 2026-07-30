-- ============================================================
-- Migration 000108: Wallet compensation outbox
-- ============================================================
-- Retries failed compensating DB refunds after withdraw/P2P
-- on-chain send failures (prevents silent underpayment).
-- ============================================================

CREATE TABLE IF NOT EXISTS compensation_outbox (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind                  VARCHAR(40) NOT NULL
                          CHECK (kind IN ('withdrawal_refund', 'p2p_refund')),
    user_id               UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    counterparty_user_id  UUID REFERENCES profiles(id) ON DELETE SET NULL,
    amount_sol            DECIMAL(20, 9) NOT NULL CHECK (amount_sol > 0),
    reference_id          VARCHAR(128) NOT NULL,
    attempt_count         INT NOT NULL DEFAULT 0,
    last_attempted_at     TIMESTAMPTZ,
    next_retry_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status                VARCHAR(20) NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'succeeded', 'failed_permanent')),
    last_error            TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (kind, reference_id)
);

CREATE INDEX IF NOT EXISTS idx_compensation_outbox_pending
    ON compensation_outbox (next_retry_at)
    WHERE status = 'pending';

CREATE OR REPLACE FUNCTION update_compensation_outbox_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_compensation_outbox_updated_at ON compensation_outbox;
CREATE TRIGGER trg_compensation_outbox_updated_at
    BEFORE UPDATE ON compensation_outbox
    FOR EACH ROW EXECUTE FUNCTION update_compensation_outbox_updated_at();

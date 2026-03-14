-- ============================================================
-- Migration 000012: Payout retry queue (B-01)
-- ============================================================
-- Stores failed Solana provider payouts so they can be retried
-- with exponential backoff instead of being silently dropped.
-- ============================================================

CREATE TABLE IF NOT EXISTS payout_retry_queue (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    wallet_address    VARCHAR(64) NOT NULL,
    amount_sol        DECIMAL(20, 8) NOT NULL CHECK (amount_sol > 0),
    attempt_count     INT NOT NULL DEFAULT 0,
    last_attempted_at TIMESTAMPTZ,
    next_retry_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'succeeded', 'failed_permanent')),
    error_message     TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for the retry worker: only scan pending rows due soon
CREATE INDEX IF NOT EXISTS idx_payout_retry_pending
    ON payout_retry_queue (next_retry_at)
    WHERE status = 'pending';

-- updated_at trigger (reuse pattern from existing tables)
CREATE OR REPLACE FUNCTION update_payout_retry_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payout_retry_updated_at ON payout_retry_queue;
CREATE TRIGGER trg_payout_retry_updated_at
    BEFORE UPDATE ON payout_retry_queue
    FOR EACH ROW EXECUTE FUNCTION update_payout_retry_updated_at();

-- RLS
ALTER TABLE payout_retry_queue ENABLE ROW LEVEL SECURITY;
-- Only the service role (backend) may read/write this table
CREATE POLICY "payout_retry_service_only"
    ON payout_retry_queue FOR ALL TO service_role USING (true);

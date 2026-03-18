-- P2-11: Add expiry timestamp to disputes so open disputes can be auto-closed
-- after 30 days of inactivity.
ALTER TABLE disputes
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW() + INTERVAL '30 days';

CREATE INDEX IF NOT EXISTS idx_disputes_expires_at ON disputes (expires_at)
    WHERE status = 'open';

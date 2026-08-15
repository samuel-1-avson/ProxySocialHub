-- Wave 5.C.4 — incentive settle / custody columns (still no mint)

ALTER TABLE protocol_incentive_events

    ADD COLUMN IF NOT EXISTS recipient_wallet VARCHAR(64) NOT NULL DEFAULT '',

    ADD COLUMN IF NOT EXISTS tx_hash VARCHAR(128) NOT NULL DEFAULT '',

    ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;



CREATE INDEX IF NOT EXISTS idx_protocol_incentive_status

    ON protocol_incentive_events (status);


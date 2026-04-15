ALTER TABLE session_intents
    ADD COLUMN IF NOT EXISTS billing_price_per_gb_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS billing_price_source VARCHAR(32) NOT NULL DEFAULT 'unknown';

CREATE INDEX IF NOT EXISTS idx_session_intents_billing_price_source ON session_intents(billing_price_source);
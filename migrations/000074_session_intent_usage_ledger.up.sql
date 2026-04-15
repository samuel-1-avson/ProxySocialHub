ALTER TABLE session_intents
    ADD COLUMN IF NOT EXISTS total_bytes_up BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_bytes_down BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_bytes_up_delta BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_bytes_down_delta BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS usage_update_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_metered_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_session_intents_last_metered_at ON session_intents(last_metered_at);
-- P3: Create usage_records table for bandwidth tracking per request/session.
CREATE TABLE IF NOT EXISTS usage_records (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL,
    session_id  UUID NOT NULL,
    node_id     UUID,
    bytes_used  BIGINT NOT NULL DEFAULT 0,
    bytes_up    BIGINT DEFAULT 0,
    bytes_down  BIGINT DEFAULT 0,
    dest_host   VARCHAR(255),
    dest_port   INTEGER,
    latency_ms  INTEGER,
    success     BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_records_user_id    ON usage_records (user_id);
CREATE INDEX IF NOT EXISTS idx_usage_records_session_id ON usage_records (session_id);
CREATE INDEX IF NOT EXISTS idx_usage_records_created_at ON usage_records (created_at);

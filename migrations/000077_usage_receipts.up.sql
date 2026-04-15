CREATE TABLE IF NOT EXISTS usage_receipts (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    manifest_id           UUID,
    session_id            UUID NOT NULL,
    session_username      VARCHAR(120) NOT NULL,
    user_ref              VARCHAR(120),
    provider_ref          VARCHAR(120),
    provider_node_id      VARCHAR(120),
    route_host            VARCHAR(255),
    billing_price_per_gb  DOUBLE PRECISION NOT NULL DEFAULT 0,
    bytes_up              BIGINT NOT NULL DEFAULT 0,
    bytes_down            BIGINT NOT NULL DEFAULT 0,
    total_bytes           BIGINT NOT NULL DEFAULT 0,
    nonce                 BIGINT NOT NULL,
    signature             TEXT,
    source                VARCHAR(32) NOT NULL DEFAULT 'gateway_report',
    status                VARCHAR(20) NOT NULL DEFAULT 'pending',
    reported_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    aggregated_at         TIMESTAMPTZ,
    settled_at            TIMESTAMPTZ,
    last_error            TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_receipts_session_nonce
    ON usage_receipts (session_username, nonce);
CREATE INDEX IF NOT EXISTS idx_usage_receipts_session_id
    ON usage_receipts (session_id);
CREATE INDEX IF NOT EXISTS idx_usage_receipts_manifest_id
    ON usage_receipts (manifest_id);
CREATE INDEX IF NOT EXISTS idx_usage_receipts_status
    ON usage_receipts (status);
CREATE INDEX IF NOT EXISTS idx_usage_receipts_reported_at
    ON usage_receipts (reported_at);
CREATE INDEX IF NOT EXISTS idx_usage_receipts_user_ref
    ON usage_receipts (user_ref);
CREATE INDEX IF NOT EXISTS idx_usage_receipts_provider_ref
    ON usage_receipts (provider_ref);
CREATE TABLE IF NOT EXISTS settlement_manifests (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    window_key         VARCHAR(160) NOT NULL,
    session_id         UUID NOT NULL,
    session_username   VARCHAR(120) NOT NULL,
    user_ref           VARCHAR(120),
    provider_ref       VARCHAR(120),
    receipt_count      INTEGER NOT NULL DEFAULT 0,
    total_bytes_up     BIGINT NOT NULL DEFAULT 0,
    total_bytes_down   BIGINT NOT NULL DEFAULT 0,
    total_bytes        BIGINT NOT NULL DEFAULT 0,
    status             VARCHAR(20) NOT NULL DEFAULT 'open',
    window_started_at  TIMESTAMPTZ NOT NULL,
    window_ended_at    TIMESTAMPTZ NOT NULL,
    last_receipt_at    TIMESTAMPTZ NOT NULL,
    coordinated_at     TIMESTAMPTZ,
    settled_at         TIMESTAMPTZ,
    last_error         TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_settlement_manifests_window_key
    ON settlement_manifests (window_key);
CREATE INDEX IF NOT EXISTS idx_settlement_manifests_session_id
    ON settlement_manifests (session_id);
CREATE INDEX IF NOT EXISTS idx_settlement_manifests_status
    ON settlement_manifests (status);
CREATE INDEX IF NOT EXISTS idx_settlement_manifests_user_ref
    ON settlement_manifests (user_ref);
CREATE INDEX IF NOT EXISTS idx_settlement_manifests_provider_ref
    ON settlement_manifests (provider_ref);

ALTER TABLE usage_receipts
    ADD CONSTRAINT fk_usage_receipts_manifest
    FOREIGN KEY (manifest_id)
    REFERENCES settlement_manifests (id)
    ON DELETE SET NULL;
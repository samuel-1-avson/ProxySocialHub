-- I4: Consolidated baseline — fills the sequence gap between 000013 and 000027.
-- Migrations 000014–000026 were never created; tables in that range were either
-- applied via GORM AutoMigrate or via unnumbered SQL scripts (20260314_*, 20260315_*).
-- This file is IDEMPOTENT (all statements use IF NOT EXISTS / IF EXISTS guards).
-- Running it against a database that already has these objects is a no-op.

-- ===========================================================================
-- 000014: SOL-only wallet (from 20260314_sol_only_migration.sql)
-- Remove legacy multi-currency columns; ensure balance_sol exists.
-- ===========================================================================
ALTER TABLE wallets
    DROP COLUMN IF EXISTS balance_ghs,
    DROP COLUMN IF EXISTS balance_usdt,
    DROP COLUMN IF EXISTS currency;

ALTER TABLE wallets
    ADD COLUMN IF NOT EXISTS balance_sol NUMERIC(20,9) NOT NULL DEFAULT 0;

-- Remove the temporary backup table created by the original script (safe to keep too).
DROP TABLE IF EXISTS wallet_backup_20260314;

-- ===========================================================================
-- 000015: Provider tokens & CLI distribution (from 20260315_add_provider_tokens.sql)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS provider_tokens (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id      UUID        NOT NULL,
    token        VARCHAR(64) NOT NULL,
    name         VARCHAR(100),
    last_used    TIMESTAMPTZ,
    expires_at   TIMESTAMPTZ,
    is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at   TIMESTAMPTZ,
    CONSTRAINT uq_provider_tokens_token UNIQUE (token)
);
CREATE INDEX IF NOT EXISTS idx_provider_tokens_user_id   ON provider_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_provider_tokens_token      ON provider_tokens (token);
CREATE INDEX IF NOT EXISTS idx_provider_tokens_deleted_at ON provider_tokens (deleted_at);

CREATE TABLE IF NOT EXISTS cli_downloads (
    id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    version      VARCHAR(20)  NOT NULL,
    platform     VARCHAR(20)  NOT NULL,
    arch         VARCHAR(20)  NOT NULL,
    filename     VARCHAR(255) NOT NULL,
    file_path    VARCHAR(500) NOT NULL,
    file_size    BIGINT,
    checksum     VARCHAR(64),
    download_url VARCHAR(500),
    is_latest    BOOLEAN      NOT NULL DEFAULT FALSE,
    is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cli_downloads_is_latest ON cli_downloads (is_latest);

CREATE TABLE IF NOT EXISTS provider_node_registrations (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID        NOT NULL,
    token_id    UUID        NOT NULL,
    node_id     UUID        NOT NULL,
    ip_address  VARCHAR(45),
    hostname    VARCHAR(100),
    cli_version VARCHAR(20),
    first_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_pnr_user_id   ON provider_node_registrations (user_id);
CREATE INDEX IF NOT EXISTS idx_pnr_token_id  ON provider_node_registrations (token_id);
CREATE INDEX IF NOT EXISTS idx_pnr_node_id   ON provider_node_registrations (node_id);

-- ===========================================================================
-- 000016: Provider earnings (idempotent — table may already exist from 000030)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS provider_earnings (
    id              UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_id     UUID         NOT NULL,
    session_id      UUID,
    amount_sol      NUMERIC(20,9) NOT NULL DEFAULT 0,
    fee_sol         NUMERIC(20,9) NOT NULL DEFAULT 0,
    net_sol         NUMERIC(20,9) NOT NULL DEFAULT 0,
    status          VARCHAR(20)  NOT NULL DEFAULT 'pending',
    payout_batch_id UUID,
    tx_hash         VARCHAR(128),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_provider_earnings_provider_id ON provider_earnings (provider_id);
CREATE INDEX IF NOT EXISTS idx_provider_earnings_status       ON provider_earnings (status);
CREATE INDEX IF NOT EXISTS idx_provider_earnings_created_at   ON provider_earnings (created_at);

-- ===========================================================================
-- 000017: Disputes (idempotent — table may already exist from 000031)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS disputes (
    id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id     UUID        NOT NULL,
    claimant_id  UUID        NOT NULL,
    respondent_id UUID       NOT NULL,
    reason       TEXT        NOT NULL,
    status       VARCHAR(20) NOT NULL DEFAULT 'open',
    resolution   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_disputes_order_id     ON disputes (order_id);
CREATE INDEX IF NOT EXISTS idx_disputes_claimant_id  ON disputes (claimant_id);
CREATE INDEX IF NOT EXISTS idx_disputes_status       ON disputes (status);

-- ===========================================================================
-- 000018: Batch payouts (idempotent — tables may already exist from 000029)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS batch_payouts (
    id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    status       VARCHAR(20) NOT NULL DEFAULT 'pending',
    total_sol    NUMERIC(20,9) NOT NULL DEFAULT 0,
    item_count   INT         NOT NULL DEFAULT 0,
    tx_hash      VARCHAR(128),
    error_msg    TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS batch_payout_items (
    id             UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    batch_id       UUID         NOT NULL REFERENCES batch_payouts(id) ON DELETE CASCADE,
    provider_id    UUID         NOT NULL,
    amount_sol     NUMERIC(20,9) NOT NULL,
    wallet_address VARCHAR(64)  NOT NULL,
    status         VARCHAR(20)  NOT NULL DEFAULT 'pending',
    error_msg      TEXT,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_batch_payout_items_batch_id    ON batch_payout_items (batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_payout_items_provider_id ON batch_payout_items (provider_id);

CREATE TABLE IF NOT EXISTS pending_payouts (
    id             UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_id    UUID         NOT NULL,
    amount_sol     NUMERIC(20,9) NOT NULL,
    wallet_address VARCHAR(64)  NOT NULL,
    earning_id     UUID,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pending_payouts_provider_id ON pending_payouts (provider_id);

-- ===========================================================================
-- Track that this baseline has been applied
-- ===========================================================================
INSERT INTO schema_migrations (version, description)
    VALUES (34, 'Consolidated baseline filling gap 000014-000026')
    ON CONFLICT (version) DO NOTHING;

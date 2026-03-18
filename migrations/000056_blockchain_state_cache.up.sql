CREATE TABLE IF NOT EXISTS blockchain_state_cache (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    pda             VARCHAR(64) NOT NULL,
    program_id      VARCHAR(64) NOT NULL,
    account_type    VARCHAR(50) NOT NULL,
    data            JSONB       NOT NULL DEFAULT '{}',
    slot            BIGINT      NOT NULL DEFAULT 0,
    signature       VARCHAR(128),
    last_synced_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    buyer_address   VARCHAR(64),
    seller_address  VARCHAR(64),
    status          VARCHAR(50),
    CONSTRAINT uq_blockchain_state_cache_pda UNIQUE (pda)
);

CREATE INDEX IF NOT EXISTS idx_cache_type    ON blockchain_state_cache (account_type);
CREATE INDEX IF NOT EXISTS idx_cache_buyer   ON blockchain_state_cache (buyer_address);
CREATE INDEX IF NOT EXISTS idx_cache_seller  ON blockchain_state_cache (seller_address);
CREATE INDEX IF NOT EXISTS idx_cache_status  ON blockchain_state_cache (status);

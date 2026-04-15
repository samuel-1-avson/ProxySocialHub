CREATE TABLE IF NOT EXISTS session_intents (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    listing_id UUID NULL,
    session_type VARCHAR(50) NOT NULL,
    lifecycle_state VARCHAR(20) NOT NULL DEFAULT 'authorized',
    trust_tier VARCHAR(50) NULL,
    bandwidth_limit BIGINT NOT NULL DEFAULT 0,
    target_geo VARCHAR(16) NULL,
    target_isp VARCHAR(120) NULL,
    routing_profile VARCHAR(120) NULL,
    allowed_domains TEXT[] NOT NULL DEFAULT '{}',
    blocked_domains TEXT[] NOT NULL DEFAULT '{}',
    rotation_type VARCHAR(32) NULL,
    rotation_interval_seconds INTEGER NOT NULL DEFAULT 0,
    time_limit_minutes INTEGER NOT NULL DEFAULT 0,
    preferred_tier VARCHAR(50) NULL,
    requests_per_minute INTEGER NOT NULL DEFAULT 0,
    max_concurrency INTEGER NOT NULL DEFAULT 0,
    max_price_per_gb DOUBLE PRECISION NOT NULL DEFAULT 0,
    provider_node_id VARCHAR(120) NULL,
    target_host VARCHAR(255) NULL,
    activated_at TIMESTAMPTZ NULL,
    last_seen_at TIMESTAMPTZ NULL,
    expired_at TIMESTAMPTZ NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_session_intents_user_id ON session_intents(user_id);
CREATE INDEX IF NOT EXISTS idx_session_intents_listing_id ON session_intents(listing_id);
CREATE INDEX IF NOT EXISTS idx_session_intents_lifecycle_state ON session_intents(lifecycle_state);
CREATE INDEX IF NOT EXISTS idx_session_intents_provider_node_id ON session_intents(provider_node_id);
CREATE INDEX IF NOT EXISTS idx_session_intents_expires_at ON session_intents(expires_at);
CREATE INDEX IF NOT EXISTS idx_session_intents_deleted_at ON session_intents(deleted_at);
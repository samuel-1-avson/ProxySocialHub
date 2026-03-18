-- Use cases for smart matching engine
CREATE TABLE IF NOT EXISTS use_cases (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    requirements JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User matching preferences
CREATE TABLE IF NOT EXISTS user_preferences (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                 UUID NOT NULL,
    preferred_use_case_id   UUID REFERENCES use_cases(id) ON DELETE SET NULL,
    preferred_regions       TEXT[],
    max_price_per_gb        NUMERIC(10,2),
    min_seller_rating       NUMERIC(3,2),
    prefer_verified_sellers BOOLEAN NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_preferences_user_id ON user_preferences(user_id);

-- Match requests logged by the smart matching engine
CREATE TABLE IF NOT EXISTS match_requests (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL,
    use_case            VARCHAR(50),
    preferred_geo       VARCHAR(10),
    preferred_isp       VARCHAR(100),
    max_price_per_gb    NUMERIC(10,4),
    min_uptime_percent  NUMERIC(5,2),
    max_latency_ms      INTEGER,
    session_type        VARCHAR(20),
    required_tier       VARCHAR(20),
    bandwidth_gb        NUMERIC(12,4),
    matched_listing_id  UUID REFERENCES proxy_listings(id) ON DELETE SET NULL,
    match_score         NUMERIC(5,4),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_match_requests_user_id ON match_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_match_requests_created_at ON match_requests(created_at DESC);

-- Core marketplace tables that were created directly in Supabase
-- and never captured in a migration file. Required before 000004 indexes.

-- PROXY LISTINGS
CREATE TABLE IF NOT EXISTS proxy_listings (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    seller_id               UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    title                   VARCHAR(200) NOT NULL,
    description             TEXT,
    proxy_type              VARCHAR(50) DEFAULT 'residential',
    protocol                VARCHAR(20) DEFAULT 'HTTP',
    rotation_type           VARCHAR(20) DEFAULT 'static',
    circle_id               UUID REFERENCES public.circles(id) ON DELETE SET NULL,
    country                 VARCHAR(50),
    isp                     VARCHAR(100),
    price_per_gb            NUMERIC(20,4) NOT NULL DEFAULT 0,
    min_purchase_gb         NUMERIC(20,4) DEFAULT 1,
    bulk_discounts          JSONB DEFAULT '[]',
    available_bandwidth_gb  NUMERIC(20,4) NOT NULL DEFAULT 0,
    max_concurrency         INT DEFAULT 5,
    avg_latency_ms          INT DEFAULT 0,
    uptime_percentage       NUMERIC(5,2) DEFAULT 100,
    success_rate            NUMERIC(5,2) DEFAULT 100,
    quality_score           NUMERIC(5,2) DEFAULT 100,
    views_count             INT DEFAULT 0,
    saves_count             INT DEFAULT 0,
    orders_count            INT DEFAULT 0,
    status                  VARCHAR(50) DEFAULT 'active',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ORDERS
CREATE TABLE IF NOT EXISTS orders (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    buyer_id            UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    seller_id           UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    listing_id          UUID NOT NULL REFERENCES proxy_listings(id) ON DELETE CASCADE,
    bandwidth_gb        NUMERIC(20,4) NOT NULL,
    price_per_gb        NUMERIC(20,4) NOT NULL,
    total_price         NUMERIC(20,4) NOT NULL,
    status              VARCHAR(50) DEFAULT 'pending',
    tx_hash             VARCHAR(255),
    session_id          UUID REFERENCES public.sessions(id) ON DELETE SET NULL,
    escrow_pda          VARCHAR(64),
    buyer_wallet        VARCHAR(64),
    seller_wallet       VARCHAR(64),
    amount_locked_sol   NUMERIC(20,9) DEFAULT 0,
    bandwidth_limit_gb  BIGINT DEFAULT 0,
    payment_method      VARCHAR(50),
    tx_signature        VARCHAR(128),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ESCROW TRANSACTIONS
CREATE TABLE IF NOT EXISTS escrow_transactions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    buyer_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    seller_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    amount          NUMERIC(20,4) NOT NULL,
    status          VARCHAR(50) DEFAULT 'held',
    held_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    released_at     TIMESTAMPTZ,
    auto_release_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ESCROW MILESTONES
CREATE TABLE IF NOT EXISTS escrow_milestones (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    escrow_id           UUID NOT NULL REFERENCES escrow_transactions(id) ON DELETE CASCADE,
    byte_threshold      BIGINT DEFAULT 0,
    amount              NUMERIC(20,4) DEFAULT 0,
    status              VARCHAR(50) DEFAULT 'pending',
    released_at         TIMESTAMPTZ,
    verification_proof  TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ESCROW DISPUTES
CREATE TABLE IF NOT EXISTS escrow_disputes (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    escrow_id       UUID NOT NULL REFERENCES escrow_transactions(id) ON DELETE CASCADE,
    order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    initiated_by    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    reason          VARCHAR(50) NOT NULL,
    description     TEXT,
    evidence_urls   JSONB DEFAULT '[]',
    status          VARCHAR(50) DEFAULT 'open',
    resolution      TEXT,
    resolved_by     UUID REFERENCES profiles(id) ON DELETE SET NULL,
    resolved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

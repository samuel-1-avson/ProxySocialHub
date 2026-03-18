-- Tables created directly in Supabase (never migrated).
-- Must exist before numbered migrations 000005+ which ALTER/INDEX them.
-- All statements are idempotent (CREATE TABLE IF NOT EXISTS).

-- AUDIT LOGS PARTITIONED (needed by migration 000011)
CREATE TABLE IF NOT EXISTS audit_logs_partitioned (
    id          UUID NOT NULL DEFAULT uuid_generate_v4(),
    event_type  VARCHAR(50) NOT NULL,
    severity    VARCHAR(20) DEFAULT 'info',
    actor_id    UUID,
    actor_type  VARCHAR(20),
    actor_email VARCHAR(255),
    target_type VARCHAR(50),
    target_id   VARCHAR(64),
    ip_address  VARCHAR(45),
    user_agent  TEXT,
    country     VARCHAR(2),
    session_id  UUID,
    description TEXT,
    metadata    JSONB,
    success     BOOLEAN DEFAULT TRUE,
    error_code  VARCHAR(50),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);

-- Default partition so inserts never fail before monthly partitions are created
CREATE TABLE IF NOT EXISTS audit_logs_partitioned_default
    PARTITION OF audit_logs_partitioned DEFAULT;

-- Helper function called by migration 000011 pg_cron job
CREATE OR REPLACE FUNCTION create_audit_partition_if_not_exists() RETURNS VOID AS $$
DECLARE
    next_month DATE := (date_trunc('month', NOW()) + INTERVAL '1 month')::DATE;
    month_after DATE := (date_trunc('month', NOW()) + INTERVAL '2 months')::DATE;
    tbl_name TEXT;
BEGIN
    tbl_name := 'audit_logs_' || to_char(next_month, 'YYYY_MM');
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_logs_partitioned FOR VALUES FROM (%L) TO (%L)',
        tbl_name, next_month, month_after
    );
END;
$$ LANGUAGE plpgsql;

-- PROVIDER NODES (needed by migration 000005)
CREATE TABLE IF NOT EXISTS provider_nodes (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                 UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name                    VARCHAR(100) NOT NULL,
    ip_address              INET,
    country                 VARCHAR(2),
    city                    VARCHAR(100),
    status                  VARCHAR(50) DEFAULT 'offline',
    total_bandwidth_gb      NUMERIC(20,4) DEFAULT 0,
    quality_score           NUMERIC(5,2) DEFAULT 100,
    last_seen_at            TIMESTAMPTZ,
    is_registered_on_chain  BOOLEAN DEFAULT FALSE,
    net_uid                 INT DEFAULT 0,
    hotkey                  VARCHAR(64),
    staked_amount_sol       NUMERIC(20,9) DEFAULT 0,
    stake_pda               VARCHAR(64),
    stake_status            VARCHAR(20) DEFAULT 'none',
    wallet_address          VARCHAR(64),
    tier                    VARCHAR(20) DEFAULT 'unverified',
    tier_verified_at        TIMESTAMPTZ,
    tier_score              NUMERIC(5,2) DEFAULT 0,
    uptime_percent          NUMERIC(5,2) DEFAULT 0,
    total_sessions_served   INT DEFAULT 0,
    avg_latency_ms          INT DEFAULT 0,
    dispute_count           INT DEFAULT 0,
    demotion_warnings       INT DEFAULT 0,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_provider_nodes_user_id ON provider_nodes(user_id);
CREATE INDEX IF NOT EXISTS idx_provider_nodes_status  ON provider_nodes(status);

-- PENDING TRANSACTIONS (user_id starts as VARCHAR so migration 000047 can convert it to UUID)
CREATE TABLE IF NOT EXISTS pending_transactions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reference       VARCHAR(128) UNIQUE NOT NULL,
    external_ref    VARCHAR(128),
    idempotency_key VARCHAR(128) UNIQUE,
    user_id         VARCHAR(100) NOT NULL,
    type            VARCHAR(20) NOT NULL,
    amount          NUMERIC(20,9) NOT NULL,
    currency        VARCHAR(20) DEFAULT 'SOL',
    provider        VARCHAR(20) NOT NULL,
    phone           VARCHAR(20),
    status          VARCHAR(20) DEFAULT 'pending',
    failure_reason  TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- FORUM CATEGORIES (needed by migration 000007 seed data)
CREATE TABLE IF NOT EXISTS forum_categories (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(100) UNIQUE NOT NULL,
    slug        VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    icon        VARCHAR(50),
    sort_order  INT DEFAULT 0,
    is_locked   BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- FORUM THREADS
CREATE TABLE IF NOT EXISTS forum_threads (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category_id     UUID NOT NULL REFERENCES forum_categories(id) ON DELETE CASCADE,
    author_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    title           VARCHAR(255) NOT NULL,
    slug            VARCHAR(255) NOT NULL,
    content         TEXT NOT NULL,
    is_pinned       BOOLEAN DEFAULT FALSE,
    is_locked       BOOLEAN DEFAULT FALSE,
    views_count     INT DEFAULT 0,
    replies_count   INT DEFAULT 0,
    upvotes         INT DEFAULT 0,
    downvotes       INT DEFAULT 0,
    last_reply_at   TIMESTAMPTZ,
    last_reply_by   UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_forum_threads_category ON forum_threads(category_id);
CREATE INDEX IF NOT EXISTS idx_forum_threads_author   ON forum_threads(author_id);

-- FORUM POSTS
CREATE TABLE IF NOT EXISTS forum_posts (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    thread_id   UUID NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
    author_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    is_solution BOOLEAN DEFAULT FALSE,
    upvotes     INT DEFAULT 0,
    downvotes   INT DEFAULT 0,
    parent_id   UUID REFERENCES forum_posts(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_forum_posts_thread ON forum_posts(thread_id);

-- CONVERSATIONS
CREATE TABLE IF NOT EXISTS conversations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    participant1    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    participant2    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    listing_id      UUID REFERENCES proxy_listings(id) ON DELETE SET NULL,
    last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- MESSAGES
CREATE TABLE IF NOT EXISTS messages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    content         TEXT NOT NULL,
    read_at         TIMESTAMPTZ,
    type            VARCHAR(20) DEFAULT 'text',
    reply_to_id     UUID REFERENCES messages(id) ON DELETE SET NULL,
    edited_at       TIMESTAMPTZ,
    is_deleted      BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);

-- MESSAGE REACTIONS
CREATE TABLE IF NOT EXISTS message_reactions (
    message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    emoji       VARCHAR(10) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (message_id, user_id, emoji)
);

-- EXPLORER BLOCKS
CREATE TABLE IF NOT EXISTS explorer_blocks (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    block_hash        VARCHAR(128) UNIQUE,
    block_number      BIGINT UNIQUE,
    chain             VARCHAR(20) DEFAULT 'solana',
    parent_hash       VARCHAR(128),
    timestamp         TIMESTAMPTZ,
    transaction_count INT DEFAULT 0,
    validator_pubkey  VARCHAR(128),
    slot              BIGINT DEFAULT 0,
    is_orphaned       BOOLEAN DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_explorer_blocks_chain       ON explorer_blocks(chain);
CREATE INDEX IF NOT EXISTS idx_explorer_blocks_block_number ON explorer_blocks(block_number DESC);

-- EXPLORER TRANSACTIONS
CREATE TABLE IF NOT EXISTS explorer_transactions (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tx_hash       VARCHAR(128) UNIQUE,
    chain         VARCHAR(20) DEFAULT 'solana',
    block_hash    VARCHAR(128),
    block_number  BIGINT,
    from_address  VARCHAR(128),
    to_address    VARCHAR(128),
    amount        NUMERIC(20,8),
    currency      VARCHAR(20) DEFAULT 'SOL',
    token_mint    VARCHAR(128),
    is_orphaned   BOOLEAN DEFAULT FALSE,
    fee           NUMERIC(20,8),
    status        VARCHAR(20),
    tx_type       VARCHAR(50),
    program_id    VARCHAR(128),
    timestamp     TIMESTAMPTZ,
    confirmations INT DEFAULT 0,
    raw_data      TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_explorer_tx_chain       ON explorer_transactions(chain);
CREATE INDEX IF NOT EXISTS idx_explorer_tx_from        ON explorer_transactions(from_address);
CREATE INDEX IF NOT EXISTS idx_explorer_tx_to          ON explorer_transactions(to_address);
CREATE INDEX IF NOT EXISTS idx_explorer_tx_timestamp   ON explorer_transactions(timestamp DESC);

-- EXPLORER NODES
CREATE TABLE IF NOT EXISTS explorer_nodes (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    node_id         VARCHAR(128) UNIQUE,
    chain           VARCHAR(20),
    name            VARCHAR(255),
    ip              VARCHAR(45),
    region          VARCHAR(50),
    country         VARCHAR(50),
    city            VARCHAR(100),
    isp             VARCHAR(200),
    latitude        NUMERIC(10,6) DEFAULT 0,
    longitude       NUMERIC(10,6) DEFAULT 0,
    is_active       BOOLEAN DEFAULT TRUE,
    is_validator    BOOLEAN DEFAULT FALSE,
    stake_amount    NUMERIC(20,8) DEFAULT 0,
    commission_rate NUMERIC(5,2) DEFAULT 0,
    uptime_percent  NUMERIC(5,2) DEFAULT 0,
    total_bandwidth BIGINT DEFAULT 0,
    active_sessions INT DEFAULT 0,
    last_heartbeat  TIMESTAMPTZ,
    version         VARCHAR(50),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_explorer_nodes_chain     ON explorer_nodes(chain);
CREATE INDEX IF NOT EXISTS idx_explorer_nodes_is_active ON explorer_nodes(is_active);

-- PROVIDER TOKENS (needed by migration 000033 FK constraints — created before 000034)
CREATE TABLE IF NOT EXISTS provider_tokens (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL,
    token       VARCHAR(64) NOT NULL,
    name        VARCHAR(100),
    last_used   TIMESTAMPTZ,
    expires_at  TIMESTAMPTZ,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ,
    CONSTRAINT uq_provider_tokens_token UNIQUE (token)
);
CREATE INDEX IF NOT EXISTS idx_provider_tokens_user_id ON provider_tokens(user_id);

-- PROVIDER NODE REGISTRATIONS (needed by migration 000033 FK constraints)
CREATE TABLE IF NOT EXISTS provider_node_registrations (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL,
    token_id    UUID NOT NULL REFERENCES provider_tokens(id) ON DELETE CASCADE,
    node_id     UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    ip_address  VARCHAR(45),
    hostname    VARCHAR(100),
    cli_version VARCHAR(20),
    first_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active   BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_pnr_user_id  ON provider_node_registrations(user_id);
CREATE INDEX IF NOT EXISTS idx_pnr_token_id ON provider_node_registrations(token_id);
CREATE INDEX IF NOT EXISTS idx_pnr_node_id  ON provider_node_registrations(node_id);

-- SUBSCRIPTION PLANS (needed by migration 000051 seed data)
CREATE TABLE IF NOT EXISTS subscription_plans (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                VARCHAR(100) UNIQUE NOT NULL,
    description         TEXT,
    price_monthly       NUMERIC(10,2) NOT NULL DEFAULT 0,
    price_yearly        NUMERIC(10,2),
    features            JSONB,
    bandwidth_limit_gb  INT,
    listing_limit       INT NOT NULL DEFAULT 5,
    priority_support    BOOLEAN NOT NULL DEFAULT FALSE,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SOFT DELETES MIGRATION
-- Adds deleted_at column to all mutable tables for soft delete support
-- ============================================================

-- Core User Tables
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE wallet_ledger_entries ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Session & Auth Tables
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE refresh_token_families ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Marketplace Tables
ALTER TABLE proxy_listings ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE saved_listings ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Escrow & Disputes
ALTER TABLE escrow_transactions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Provider & Circles
ALTER TABLE provider_nodes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE circles ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE circle_members ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE circle_invites ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE circle_leases ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Social
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE follows ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE feed_events ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE friendships ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE friend_requests ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Messaging
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Governance
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE votes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Forum
ALTER TABLE forum_categories ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE forum_threads ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE forum_posts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Agents
ALTER TABLE market_agents ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE agent_instances ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE agent_jobs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE agent_outputs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Blockchain
ALTER TABLE linked_wallets ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE blockchain_state_cache ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE pending_transactions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- ============================================================
-- SOFT DELETE INDEXES
-- Partial indexes for non-deleted records (performance optimization)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_profiles_active ON profiles(id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_wallets_active ON wallets(user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(user_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_orders_active ON orders(buyer_id, seller_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_listings_active ON proxy_listings(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_circles_active ON circles(id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_messages_active ON messages(conversation_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_proposals_active ON proposals(status) WHERE deleted_at IS NULL;

-- ============================================================
-- AUDIT LOGS PARTITIONING
-- Partition by month for efficient querying and archival
-- ============================================================

-- Note: Partitioning existing tables requires recreating them
-- This is a guide for new installations or planned migrations

-- Step 1: Create partitioned table
CREATE TABLE IF NOT EXISTS audit_logs_partitioned (
    id UUID NOT NULL,
    actor_id UUID,
    actor_email VARCHAR(255),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(100),
    details JSONB,
    ip_address VARCHAR(45),
    user_agent VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);

-- Step 2: Create monthly partitions (create as needed)
-- Current month
CREATE TABLE IF NOT EXISTS audit_logs_2026_01 PARTITION OF audit_logs_partitioned
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

CREATE TABLE IF NOT EXISTS audit_logs_2026_02 PARTITION OF audit_logs_partitioned
    FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');

CREATE TABLE IF NOT EXISTS audit_logs_2026_03 PARTITION OF audit_logs_partitioned
    FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');

-- Future months can be auto-created via a scheduled job

-- Step 3: Create indexes on partitioned table
CREATE INDEX IF NOT EXISTS idx_audit_partitioned_actor ON audit_logs_partitioned(actor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_partitioned_entity ON audit_logs_partitioned(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_partitioned_action ON audit_logs_partitioned(action, created_at);

-- Step 4: Migration procedure (run when ready)
-- INSERT INTO audit_logs_partitioned SELECT * FROM audit_logs;
-- ALTER TABLE audit_logs RENAME TO audit_logs_old;
-- ALTER TABLE audit_logs_partitioned RENAME TO audit_logs;

-- ============================================================
-- AUTO-PARTITION FUNCTION (for cron jobs)
-- ============================================================

CREATE OR REPLACE FUNCTION create_audit_partition_if_not_exists()
RETURNS void AS $$
DECLARE
    partition_date DATE;
    partition_name TEXT;
    start_date DATE;
    end_date DATE;
BEGIN
    -- Get first day of next month
    partition_date := DATE_TRUNC('month', NOW()) + INTERVAL '1 month';
    start_date := partition_date;
    end_date := partition_date + INTERVAL '1 month';
    partition_name := 'audit_logs_' || TO_CHAR(partition_date, 'YYYY_MM');
    
    -- Create partition if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM pg_class WHERE relname = partition_name
    ) THEN
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_logs_partitioned FOR VALUES FROM (%L) TO (%L)',
            partition_name,
            start_date,
            end_date
        );
        RAISE NOTICE 'Created partition: %', partition_name;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Schedule this function to run monthly via pg_cron or external scheduler
-- SELECT cron.schedule('create_audit_partition', '0 0 25 * *', 'SELECT create_audit_partition_if_not_exists()');

COMMENT ON FUNCTION create_audit_partition_if_not_exists() IS 'Auto-creates monthly audit_logs partition for next month';

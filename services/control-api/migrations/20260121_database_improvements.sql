-- Database Improvements Migration
-- Run this migration to add:
-- 1. New blockchain-aware tables
-- 2. Missing indexes for performance
-- 3. Encrypted credentials table

-- ============================================================
-- NEW TABLES
-- ============================================================

-- Linked Wallets: Multi-chain wallet management
CREATE TABLE IF NOT EXISTS linked_wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    chain VARCHAR(20) NOT NULL,
    address VARCHAR(64) NOT NULL,
    verified BOOLEAN DEFAULT FALSE,
    verification_signature TEXT,
    verification_message VARCHAR(255),
    is_primary BOOLEAN DEFAULT FALSE,
    label VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(chain, address)
);

-- Blockchain State Cache: On-chain state sync
CREATE TABLE IF NOT EXISTS blockchain_state_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pda VARCHAR(64) NOT NULL UNIQUE,
    program_id VARCHAR(64) NOT NULL,
    account_type VARCHAR(50) NOT NULL,
    data JSONB NOT NULL,
    slot BIGINT NOT NULL,
    signature VARCHAR(128),
    last_synced_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    -- Denormalized fields for quick queries
    buyer_address VARCHAR(64),
    seller_address VARCHAR(64),
    status VARCHAR(50)
);

-- Encrypted Credentials: Secure session credential storage
CREATE TABLE IF NOT EXISTS encrypted_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
    username_enc TEXT NOT NULL,
    password_enc TEXT NOT NULL,
    encrypted_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES - LINKED WALLETS
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_linked_wallet_user ON linked_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_linked_wallet_chain ON linked_wallets(chain);
CREATE UNIQUE INDEX IF NOT EXISTS idx_linked_wallet_unique ON linked_wallets(chain, address);

-- ============================================================
-- INDEXES - BLOCKCHAIN CACHE
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_cache_pda ON blockchain_state_cache(pda);
CREATE INDEX IF NOT EXISTS idx_cache_type ON blockchain_state_cache(account_type);
CREATE INDEX IF NOT EXISTS idx_cache_buyer ON blockchain_state_cache(buyer_address);
CREATE INDEX IF NOT EXISTS idx_cache_seller ON blockchain_state_cache(seller_address);
CREATE INDEX IF NOT EXISTS idx_cache_status ON blockchain_state_cache(status);

-- ============================================================
-- INDEXES - ORDERS (Blockchain fields)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_order_buyer_wallet ON orders(buyer_wallet) WHERE buyer_wallet IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_seller_wallet ON orders(seller_wallet) WHERE seller_wallet IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_escrow_pda ON orders(escrow_pda) WHERE escrow_pda IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_status_created ON orders(status, created_at DESC);

-- ============================================================
-- INDEXES - SESSIONS (Performance)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_session_user_status ON sessions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_session_node_status ON sessions(node_id, status) WHERE node_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_session_listing_status ON sessions(listing_id, status) WHERE listing_id IS NOT NULL;

-- ============================================================
-- INDEXES - LISTINGS (Search optimization)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_listing_search ON proxy_listings(status, proxy_type, country);
CREATE INDEX IF NOT EXISTS idx_listing_price ON proxy_listings(price_per_gb, status);
CREATE INDEX IF NOT EXISTS idx_listing_quality ON proxy_listings(quality_score DESC, status);

-- ============================================================
-- INDEXES - AUDIT LOGS (Query performance)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_audit_actor_time ON audit_logs(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action, created_at DESC);

-- ============================================================
-- INDEXES - WALLET LEDGER (Transaction history)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_ledger_wallet_time ON wallet_ledger_entries(wallet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_type ON wallet_ledger_entries(type, created_at DESC);

-- ============================================================
-- INDEXES - ESCROW & DISPUTES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_escrow_buyer ON escrow_transactions(buyer_id, status);
CREATE INDEX IF NOT EXISTS idx_escrow_seller ON escrow_transactions(seller_id, status);
CREATE INDEX IF NOT EXISTS idx_dispute_status ON disputes(status, created_at DESC);

-- ============================================================
-- PARTITIONING - AUDIT LOGS (for large tables)
-- ============================================================

-- Note: This requires dropping and recreating the table
-- Only run if audit_logs is becoming very large

-- To enable partitioning in the future:
-- 1. Create new partitioned table
-- 2. Migrate data
-- 3. Rename tables

-- CREATE TABLE audit_logs_partitioned (
--     LIKE audit_logs INCLUDING ALL
-- ) PARTITION BY RANGE (created_at);
-- 
-- CREATE TABLE audit_logs_2026_01 PARTITION OF audit_logs_partitioned
--     FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

-- ============================================================
-- COMMENTS
-- ============================================================

COMMENT ON TABLE linked_wallets IS 'Multi-chain wallet addresses linked to user accounts';
COMMENT ON TABLE blockchain_state_cache IS 'Cache of on-chain account state for quick lookups';
COMMENT ON TABLE encrypted_credentials IS 'AES-256-GCM encrypted session credentials';

COMMENT ON INDEX idx_order_escrow_pda IS 'Fast lookup of orders by on-chain escrow PDA';
COMMENT ON INDEX idx_cache_pda IS 'Primary lookup for blockchain state by PDA address';

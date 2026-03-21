-- Migration: Add conversation_id to sessions for PAYG social integration
-- Date: 2026-03-19

-- Link sessions to conversations for persistent chat throughout session lifecycle
ALTER TABLE sessions 
    ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES conversations(id),
    ADD COLUMN IF NOT EXISTS review_prompted BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS review_prompted_at TIMESTAMP;

-- Index for quick lookup
CREATE INDEX IF NOT EXISTS idx_sessions_conversation ON sessions(conversation_id);
CREATE INDEX IF NOT EXISTS idx_sessions_review_prompted ON sessions(review_prompted) WHERE review_prompted = false;

-- Table to track provider-buyer relationships (ongoing, not just orders)
CREATE TABLE IF NOT EXISTS provider_buyer_relationships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    buyer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    first_session_at TIMESTAMP NOT NULL,
    last_session_at TIMESTAMP,
    total_sessions INT DEFAULT 0,
    total_bandwidth_gb DECIMAL(10,2) DEFAULT 0,
    total_spent DECIMAL(10,2) DEFAULT 0,
    relationship_score INT DEFAULT 0,
    status VARCHAR(20) DEFAULT 'active', -- 'active', 'vip', 'inactive'
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(provider_id, buyer_id)
);

CREATE INDEX IF NOT EXISTS idx_relationships_provider ON provider_buyer_relationships(provider_id, last_session_at DESC);
CREATE INDEX IF NOT EXISTS idx_relationships_buyer ON provider_buyer_relationships(buyer_id, last_session_at DESC);
CREATE INDEX IF NOT EXISTS idx_relationships_status ON provider_buyer_relationships(status);

-- Track usage milestones for gamification
CREATE TABLE IF NOT EXISTS usage_milestones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    provider_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    milestone_type VARCHAR(50) NOT NULL, -- 'first_gb', 'ten_gb', 'hundred_gb', 'tb_club'
    threshold_gb DECIMAL(10,2) NOT NULL,
    achieved_at TIMESTAMP DEFAULT NOW(),
    reward_claimed BOOLEAN DEFAULT false,
    reward_amount DECIMAL(10,2) DEFAULT 0,
    notified BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_milestones_user ON usage_milestones(user_id, achieved_at DESC);
CREATE INDEX IF NOT EXISTS idx_milestones_provider ON usage_milestones(provider_id, achieved_at DESC);

-- Add active_sessions_count to listings for quick lookup
ALTER TABLE proxy_listings 
    ADD COLUMN IF NOT EXISTS active_sessions_count INT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS allow_direct_message BOOLEAN DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_listings_active_sessions ON proxy_listings(active_sessions_count) WHERE active_sessions_count > 0;

-- Add online status and last_seen to users
ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_users_online ON profiles(is_online) WHERE is_online = true;

-- Comment explaining the migration
COMMENT ON TABLE provider_buyer_relationships IS 'Tracks ongoing provider-buyer relationships for PAYG model (not just single orders)';
COMMENT ON TABLE usage_milestones IS 'Usage milestones for gamification and engagement in PAYG model';
COMMENT ON COLUMN sessions.conversation_id IS 'Links session to persistent conversation for ongoing chat throughout session lifecycle';

-- =============================================
-- ProxySocialHub: Phase 11 Features
-- Referral, Tiers, Favorites, Security, etc.
-- =============================================

-- ============ Referral Program ============
CREATE TABLE IF NOT EXISTS referral_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    code VARCHAR(20) UNIQUE NOT NULL,
    uses_count INT DEFAULT 0,
    total_earnings NUMERIC(20,4) DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_referral_code ON referral_codes(code);
CREATE INDEX IF NOT EXISTS idx_referral_user ON referral_codes(user_id);

CREATE TABLE IF NOT EXISTS referral_rewards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    referrer_id UUID NOT NULL REFERENCES users(id),
    referred_id UUID NOT NULL REFERENCES users(id),
    referral_code VARCHAR(20) NOT NULL,
    reward_amount NUMERIC(20,4) NOT NULL,
    reward_type VARCHAR(50) DEFAULT 'signup', -- signup, first_purchase, subscription
    status VARCHAR(50) DEFAULT 'pending', -- pending, credited, expired
    credited_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rewards_referrer ON referral_rewards(referrer_id);

-- ============ Seller Tiers ============
ALTER TABLE users ADD COLUMN IF NOT EXISTS seller_tier VARCHAR(20) DEFAULT 'bronze';
ALTER TABLE users ADD COLUMN IF NOT EXISTS tier_updated_at TIMESTAMP WITH TIME ZONE;

-- Tier thresholds (tracked in code):
-- Bronze: 0-99 GB sold
-- Silver: 100-499 GB sold  
-- Gold: 500-999 GB sold
-- Diamond: 1000+ GB sold

-- ============ Favorites/Watchlist ============
CREATE TABLE IF NOT EXISTS favorites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    listing_id UUID NOT NULL REFERENCES proxy_listings(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, listing_id)
);
CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);

-- ============ Saved Searches ============
CREATE TABLE IF NOT EXISTS saved_searches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    name VARCHAR(100) NOT NULL,
    filters JSONB NOT NULL, -- {min_price, max_price, country, proxy_type, etc}
    notify_on_match BOOLEAN DEFAULT TRUE,
    last_notified_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_saved_searches_user ON saved_searches(user_id);

-- ============ IP Allowlists ============
CREATE TABLE IF NOT EXISTS ip_allowlists (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    ip_address INET NOT NULL,
    label VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_allowlist_user ON ip_allowlists(user_id);

-- ============ Audit Logs ============
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id UUID,
    ip_address INET,
    user_agent TEXT,
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at);

-- ============ Team Accounts ============
CREATE TABLE IF NOT EXISTS teams (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    owner_id UUID NOT NULL REFERENCES users(id),
    max_members INT DEFAULT 5,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS team_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    role VARCHAR(50) DEFAULT 'member', -- owner, admin, member
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(team_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);

-- ============ Speed Test Results ============
ALTER TABLE proxy_listings ADD COLUMN IF NOT EXISTS avg_latency_ms INT;
ALTER TABLE proxy_listings ADD COLUMN IF NOT EXISTS avg_speed_mbps NUMERIC(10,2);
ALTER TABLE proxy_listings ADD COLUMN IF NOT EXISTS uptime_percent NUMERIC(5,2) DEFAULT 100;
ALTER TABLE proxy_listings ADD COLUMN IF NOT EXISTS last_speed_test TIMESTAMP WITH TIME ZONE;

-- ============ Provider Node Management ============
CREATE TABLE IF NOT EXISTS provider_nodes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    name VARCHAR(100) NOT NULL,
    ip_address INET,
    country VARCHAR(2),
    city VARCHAR(100),
    status VARCHAR(50) DEFAULT 'offline', -- online, offline, maintenance
    total_bandwidth_gb NUMERIC(20,4) DEFAULT 0,
    last_seen_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_nodes_user ON provider_nodes(user_id);
CREATE INDEX IF NOT EXISTS idx_nodes_status ON provider_nodes(status);

-- Uptime checks table
CREATE TABLE IF NOT EXISTS uptime_checks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    node_id UUID NOT NULL REFERENCES provider_nodes(id) ON DELETE CASCADE,
    is_up BOOLEAN NOT NULL,
    latency_ms INT,
    checked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_uptime_node ON uptime_checks(node_id);
CREATE INDEX IF NOT EXISTS idx_uptime_time ON uptime_checks(checked_at);

-- =============================================
-- ProxySocialHub: Social Features Migration
-- Phase 1: Foundation
-- =============================================

-- User profiles extension
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(50) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS cover_image_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS location VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS website VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS followers_count INT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS following_count INT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reviews_count INT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avg_rating NUMERIC(2,1) DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS provider_since TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS total_bandwidth_sold NUMERIC(20,4) DEFAULT 0;

-- Create index on username for fast lookups
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- Follows relationship table
CREATE TABLE IF NOT EXISTS follows (
    follower_id UUID REFERENCES users(id) ON DELETE CASCADE,
    following_id UUID REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (follower_id, following_id),
    CHECK (follower_id != following_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);
CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id);

-- Proxy Listings (marketplace items)
CREATE TABLE IF NOT EXISTS proxy_listings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    seller_id UUID NOT NULL REFERENCES users(id),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    proxy_type VARCHAR(50) NOT NULL DEFAULT 'residential',
    protocol VARCHAR(20) NOT NULL DEFAULT 'HTTP',
    price_per_gb NUMERIC(10,4) NOT NULL,
    min_purchase_gb NUMERIC(10,4) DEFAULT 1,
    bulk_discounts JSONB DEFAULT '[]',
    available_bandwidth_gb NUMERIC(20,4) NOT NULL,
    max_concurrency INT DEFAULT 5,
    avg_latency_ms INT DEFAULT 0,
    uptime_percent NUMERIC(5,2) DEFAULT 100,
    success_rate NUMERIC(5,2) DEFAULT 100,
    views_count INT DEFAULT 0,
    saves_count INT DEFAULT 0,
    orders_count INT DEFAULT 0,
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_listings_seller ON proxy_listings(seller_id);
CREATE INDEX IF NOT EXISTS idx_listings_status ON proxy_listings(status);
CREATE INDEX IF NOT EXISTS idx_listings_price ON proxy_listings(price_per_gb);

-- Saved Listings (Bookmarks)
CREATE TABLE IF NOT EXISTS saved_listings (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    listing_id UUID REFERENCES proxy_listings(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (user_id, listing_id)
);

-- Orders (purchases)
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    buyer_id UUID NOT NULL REFERENCES users(id),
    seller_id UUID NOT NULL REFERENCES users(id),
    listing_id UUID NOT NULL REFERENCES proxy_listings(id),
    bandwidth_gb NUMERIC(20,4) NOT NULL,
    price_per_gb NUMERIC(10,4) NOT NULL,
    total_price NUMERIC(20,4) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    session_id UUID REFERENCES sessions(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders(seller_id);
CREATE INDEX IF NOT EXISTS idx_orders_listing ON orders(listing_id);

-- Reviews
CREATE TABLE IF NOT EXISTS reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reviewer_id UUID NOT NULL REFERENCES users(id),
    seller_id UUID NOT NULL REFERENCES users(id),
    listing_id UUID REFERENCES proxy_listings(id),
    order_id UUID REFERENCES orders(id),
    rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    title VARCHAR(200),
    content TEXT,
    speed_rating INT CHECK (speed_rating >= 1 AND speed_rating <= 5),
    reliability_rating INT CHECK (reliability_rating >= 1 AND reliability_rating <= 5),
    support_rating INT CHECK (support_rating >= 1 AND support_rating <= 5),
    value_rating INT CHECK (value_rating >= 1 AND value_rating <= 5),
    helpful_count INT DEFAULT 0,
    seller_response TEXT,
    response_at TIMESTAMP WITH TIME ZONE,
    verified_purchase BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reviews_seller ON reviews(seller_id);
CREATE INDEX IF NOT EXISTS idx_reviews_listing ON reviews(listing_id);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewer ON reviews(reviewer_id);

-- Conversations (direct messaging)
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    participant1 UUID NOT NULL REFERENCES users(id),
    participant2 UUID NOT NULL REFERENCES users(id),
    listing_id UUID REFERENCES proxy_listings(id),
    last_message_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (participant1, participant2)
);
CREATE INDEX IF NOT EXISTS idx_conversations_participants ON conversations(participant1, participant2);

-- Messages
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    read_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);

-- Feed Events
CREATE TABLE IF NOT EXISTS feed_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_id UUID REFERENCES users(id),
    event_type VARCHAR(50) NOT NULL,
    target_type VARCHAR(50),
    target_id UUID,
    content TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feed_actor ON feed_events(actor_id);
CREATE INDEX IF NOT EXISTS idx_feed_created ON feed_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feed_event_type ON feed_events(event_type);

-- Badges
CREATE TABLE IF NOT EXISTS badges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    icon VARCHAR(50),
    criteria JSONB DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS user_badges (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    badge_id UUID REFERENCES badges(id) ON DELETE CASCADE,
    earned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (user_id, badge_id)
);

-- Insert default badges
INSERT INTO badges (name, description, icon, criteria) VALUES
    ('Verified Seller', 'Completed KYC verification', 'shield-check', '{"requires_kyc": true}'),
    ('Top Seller', 'Sold over 1000 GB of bandwidth', 'trophy', '{"min_bandwidth_sold": 1000}'),
    ('Fast Responder', 'Average response time under 1 hour', 'zap', '{"max_response_hours": 1}'),
    ('Trusted Provider', 'Maintained 99%+ uptime for 30 days', 'star', '{"min_uptime": 99, "min_days": 30}'),
    ('Early Adopter', 'Joined during launch period', 'rocket', '{"early_adopter": true}'),
    ('Premium Member', 'Upgraded to premium tier', 'crown', '{"tier": "premium"}')
ON CONFLICT (name) DO NOTHING;

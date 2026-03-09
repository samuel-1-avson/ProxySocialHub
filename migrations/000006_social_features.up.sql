-- Migration: Social Features Enhancement
-- Created: March 9, 2026

-- ============================================
-- Notifications
-- ============================================
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(200) NOT NULL,
    body TEXT,
    
    -- Action metadata
    action_url TEXT,
    action_type VARCHAR(50),
    
    -- Related entities
    actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    target_type VARCHAR(50),
    target_id UUID,
    
    -- Status
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMPTZ,
    
    -- Delivery tracking
    channels_delivered JSONB DEFAULT '[]',
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Notification indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);

-- Notification preferences
CREATE TABLE IF NOT EXISTS notification_preferences (
    user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    
    -- Channel preferences by category
    social_in_app BOOLEAN DEFAULT TRUE,
    social_email BOOLEAN DEFAULT TRUE,
    social_push BOOLEAN DEFAULT FALSE,
    
    business_in_app BOOLEAN DEFAULT TRUE,
    business_email BOOLEAN DEFAULT TRUE,
    business_push BOOLEAN DEFAULT TRUE,
    
    community_in_app BOOLEAN DEFAULT TRUE,
    community_email BOOLEAN DEFAULT TRUE,
    community_push BOOLEAN DEFAULT FALSE,
    
    system_in_app BOOLEAN DEFAULT TRUE,
    system_email BOOLEAN DEFAULT TRUE,
    system_push BOOLEAN DEFAULT TRUE,
    
    -- Digest settings
    email_digest_frequency VARCHAR(20) DEFAULT 'immediate',
    digest_day VARCHAR(10) DEFAULT 'monday',
    digest_hour INT DEFAULT 9,
    
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Provider Showcases
-- ============================================
CREATE TABLE IF NOT EXISTS provider_showcases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    
    title VARCHAR(200) NOT NULL,
    description TEXT,
    type VARCHAR(50) NOT NULL, -- 'speed_test', 'testimonial', 'metric', 'media', 'network'
    
    -- Media
    media_urls TEXT[],
    thumbnail_url TEXT,
    
    -- Metrics
    metrics JSONB DEFAULT '{}',
    
    -- Display order
    display_order INT DEFAULT 0,
    is_featured BOOLEAN DEFAULT FALSE,
    is_public BOOLEAN DEFAULT TRUE,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_showcases_provider ON provider_showcases(provider_id);
CREATE INDEX IF NOT EXISTS idx_showcases_featured ON provider_showcases(is_featured) WHERE is_featured = TRUE;

-- ============================================
-- Speed Tests
-- ============================================
CREATE TABLE IF NOT EXISTS speed_tests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    
    -- Test results
    download_speed FLOAT, -- Mbps
    upload_speed FLOAT,   -- Mbps
    latency_ms INT,
    jitter_ms INT,
    packet_loss_percent FLOAT,
    
    -- Location
    server_location VARCHAR(100),
    proxy_location VARCHAR(100),
    
    -- Metadata
    test_type VARCHAR(50), -- 'automated', 'manual', 'customer'
    test_method VARCHAR(50),
    
    is_public BOOLEAN DEFAULT TRUE,
    tested_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_speed_tests_provider ON speed_tests(provider_id, tested_at DESC);

-- ============================================
-- Testimonials
-- ============================================
CREATE TABLE IF NOT EXISTS testimonials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    
    content TEXT NOT NULL,
    rating INT CHECK (rating >= 1 AND rating <= 5),
    
    -- Verification
    is_verified BOOLEAN DEFAULT FALSE,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    
    -- Display
    is_approved BOOLEAN DEFAULT FALSE,
    is_featured BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_testimonials_provider ON testimonials(provider_id, is_approved, is_featured);

-- ============================================
-- Provider Stats (Cached aggregates)
-- ============================================
CREATE TABLE IF NOT EXISTS provider_stats (
    provider_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    
    -- Performance
    avg_download_speed FLOAT,
    avg_upload_speed FLOAT,
    avg_latency_ms INT,
    uptime_percent FLOAT,
    
    -- Business
    total_sessions INT DEFAULT 0,
    total_bandwidth_tb FLOAT DEFAULT 0,
    active_customers INT DEFAULT 0,
    
    -- Ratings
    avg_rating FLOAT DEFAULT 0,
    total_reviews INT DEFAULT 0,
    
    -- Calculated
    last_calculated_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Enhanced Messaging
-- ============================================

-- Add new columns to messages table
ALTER TABLE messages 
    ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'text',
    ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to_id) WHERE reply_to_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_deleted ON messages(is_deleted) WHERE is_deleted = FALSE;

-- Message reactions
CREATE TABLE IF NOT EXISTS message_reactions (
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    emoji VARCHAR(10) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    PRIMARY KEY (message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_reactions_message ON message_reactions(message_id);

-- ============================================
-- Functions and Triggers
-- ============================================

-- Function to update provider stats when speed test is added
CREATE OR REPLACE FUNCTION update_provider_stats_on_speed_test()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO provider_stats (provider_id, avg_download_speed, avg_upload_speed, avg_latency_ms, last_calculated_at)
    SELECT 
        NEW.provider_id,
        AVG(download_speed),
        AVG(upload_speed),
        AVG(latency_ms)::INT,
        NOW()
    FROM speed_tests
    WHERE provider_id = NEW.provider_id AND is_public = TRUE
    ON CONFLICT (provider_id) 
    DO UPDATE SET
        avg_download_speed = EXCLUDED.avg_download_speed,
        avg_upload_speed = EXCLUDED.avg_upload_speed,
        avg_latency_ms = EXCLUDED.avg_latency_ms,
        last_calculated_at = EXCLUDED.last_calculated_at,
        updated_at = NOW();
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for speed test stats
DROP TRIGGER IF EXISTS trg_update_provider_stats_speed ON speed_tests;
CREATE TRIGGER trg_update_provider_stats_speed
    AFTER INSERT ON speed_tests
    FOR EACH ROW
    EXECUTE FUNCTION update_provider_stats_on_speed_test();

-- Function to update provider stats when testimonial is added
CREATE OR REPLACE FUNCTION update_provider_stats_on_testimonial()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_approved = TRUE THEN
        INSERT INTO provider_stats (provider_id, avg_rating, total_reviews, last_calculated_at)
        SELECT 
            NEW.provider_id,
            AVG(rating),
            COUNT(*),
            NOW()
        FROM testimonials
        WHERE provider_id = NEW.provider_id AND is_approved = TRUE
        ON CONFLICT (provider_id) 
        DO UPDATE SET
            avg_rating = EXCLUDED.avg_rating,
            total_reviews = EXCLUDED.total_reviews,
            last_calculated_at = EXCLUDED.last_calculated_at,
            updated_at = NOW();
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for testimonial stats
DROP TRIGGER IF EXISTS trg_update_provider_stats_testimonial ON testimonials;
CREATE TRIGGER trg_update_provider_stats_testimonial
    AFTER INSERT OR UPDATE ON testimonials
    FOR EACH ROW
    EXECUTE FUNCTION update_provider_stats_on_testimonial();

-- ============================================
-- Backfill existing data
-- ============================================

-- Create provider stats for existing providers
INSERT INTO provider_stats (provider_id)
SELECT id FROM profiles WHERE role = 'provider'
ON CONFLICT DO NOTHING;

-- Create default notification preferences for existing users
INSERT INTO notification_preferences (user_id)
SELECT id FROM profiles
ON CONFLICT DO NOTHING;

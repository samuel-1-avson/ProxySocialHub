-- ============================================================
-- PROXY ENGINE TABLES MIGRATION
-- Run in Supabase SQL Editor
-- ============================================================

-- Service Configurations (Provider settings)
CREATE TABLE IF NOT EXISTS service_configurations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    
    -- Protocols
    enable_http BOOLEAN DEFAULT TRUE,
    enable_https BOOLEAN DEFAULT TRUE,
    enable_socks5 BOOLEAN DEFAULT FALSE,
    enable_ssh_tunnel BOOLEAN DEFAULT FALSE,
    
    -- Speed/Quality
    max_bandwidth_mbps INT DEFAULT 100,
    priority_tier VARCHAR(20) DEFAULT 'standard',
    
    -- Geographic Access Control
    allowed_countries TEXT[],
    blocked_countries TEXT[],
    allowed_cities TEXT[],
    
    -- Usage Limits
    max_concurrent_connections INT DEFAULT 10,
    max_daily_bandwidth_gb FLOAT DEFAULT 0,
    max_requests_per_minute INT DEFAULT 1000,
    
    -- Port/Domain Access
    allowed_ports INTEGER[],
    blocked_ports INTEGER[],
    allowed_domains TEXT[],
    blocked_domains TEXT[],
    
    -- Premium Services
    captcha_solving_enabled BOOLEAN DEFAULT FALSE,
    captcha_price_per_solve FLOAT DEFAULT 0.002,
    captcha_provider_key VARCHAR(255),
    
    browser_fingerprint_enabled BOOLEAN DEFAULT FALSE,
    fingerprint_price_per_session FLOAT DEFAULT 0.01,
    
    javascript_render_enabled BOOLEAN DEFAULT FALSE,
    js_render_price_per_page FLOAT DEFAULT 0.005,
    
    screenshot_enabled BOOLEAN DEFAULT FALSE,
    screenshot_price_per_capture FLOAT DEFAULT 0.005,
    
    -- Pricing Multipliers
    price_multiplier_http FLOAT DEFAULT 1.0,
    price_multiplier_https FLOAT DEFAULT 1.0,
    price_multiplier_socks5 FLOAT DEFAULT 1.2,
    price_multiplier_ssh FLOAT DEFAULT 1.5,
    price_multiplier_priority FLOAT DEFAULT 1.5,
    
    -- Rotation
    supports_sticky_session BOOLEAN DEFAULT TRUE,
    supports_auto_rotation BOOLEAN DEFAULT TRUE,
    min_rotation_interval_sec INT DEFAULT 60,
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_svc_config_node ON service_configurations(node_id);
CREATE INDEX IF NOT EXISTS idx_svc_config_user ON service_configurations(user_id);
CREATE INDEX IF NOT EXISTS idx_svc_config_active ON service_configurations(is_active) WHERE is_active = TRUE;

-- Session Configurations (Buyer settings per session)
CREATE TABLE IF NOT EXISTS session_configurations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    
    -- Access Control
    allowed_domains TEXT[],
    blocked_domains TEXT[],
    allowed_ports INTEGER[],
    blocked_ports INTEGER[],
    
    -- Usage Limits
    bandwidth_limit_gb FLOAT DEFAULT 0,
    request_limit INT DEFAULT 0,
    time_limit_minutes INT DEFAULT 0,
    
    -- Rotation
    rotation_type VARCHAR(20) DEFAULT 'none',
    rotation_interval_seconds INT DEFAULT 60,
    sticky_target VARCHAR(255),
    
    -- Quality Preferences
    preferred_country VARCHAR(10),
    preferred_city VARCHAR(100),
    preferred_isp VARCHAR(100),
    min_quality_score FLOAT DEFAULT 0,
    max_latency_ms INT DEFAULT 0,
    
    -- Protocol
    preferred_protocol VARCHAR(20),
    
    -- Premium Features
    use_captcha_solving BOOLEAN DEFAULT FALSE,
    use_javascript_render BOOLEAN DEFAULT FALSE,
    use_browser_fingerprint BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_config ON session_configurations(session_id);
CREATE INDEX IF NOT EXISTS idx_session_config_user ON session_configurations(user_id);

-- Routing Profiles (Intelligent routing presets)
CREATE TABLE IF NOT EXISTS routing_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    use_case VARCHAR(50),
    is_default BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    
    -- Weighted Priorities (0.0-1.0)
    speed_weight FLOAT DEFAULT 0.5,
    stability_weight FLOAT DEFAULT 0.5,
    price_weight FLOAT DEFAULT 0.5,
    location_weight FLOAT DEFAULT 0.3,
    
    -- Auto-Features
    auto_rotation BOOLEAN DEFAULT FALSE,
    rotation_interval_seconds INT DEFAULT 300,
    auto_failover BOOLEAN DEFAULT TRUE,
    max_retries INT DEFAULT 3,
    
    -- Recommended Settings
    recommended_protocols TEXT[],
    recommended_tier VARCHAR(20),
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_routing_profile_use_case ON routing_profiles(use_case);
CREATE INDEX IF NOT EXISTS idx_routing_profile_active ON routing_profiles(is_active) WHERE is_active = TRUE;

-- Enable RLS on new tables
ALTER TABLE service_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE routing_profiles ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "service_configs_own" ON service_configurations
    FOR ALL TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "session_configs_own" ON session_configurations
    FOR ALL TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "routing_profiles_view" ON routing_profiles
    FOR SELECT TO authenticated
    USING (is_active = true);

-- Seed default routing profiles
INSERT INTO routing_profiles (name, slug, description, use_case, speed_weight, stability_weight, price_weight, location_weight, auto_rotation, rotation_interval_seconds, recommended_protocols, recommended_tier) VALUES
('Web Scraping', 'web-scraping', 'Optimized for high-volume web scraping and data extraction', 'web_scraping', 0.7, 0.8, 0.5, 0.3, true, 60, ARRAY['http', 'https'], 'priority'),
('Social Media', 'social-media', 'Residential IPs for social media management', 'social_media', 0.4, 0.9, 0.3, 0.8, false, 300, ARRAY['http', 'https'], 'priority'),
('E-Commerce', 'e-commerce', 'Stable connections for price monitoring and checkout', 'e_commerce', 0.6, 0.9, 0.3, 0.5, true, 300, ARRAY['http', 'https'], 'standard'),
('Gaming', 'gaming', 'Low-latency connections for gaming and real-time apps', 'gaming', 0.95, 0.7, 0.2, 0.9, false, 0, ARRAY['socks5'], 'enterprise'),
('Streaming', 'streaming', 'High-bandwidth connections for video streaming', 'streaming', 0.95, 0.6, 0.3, 0.7, false, 0, ARRAY['socks5', 'http'], 'priority'),
('SEO Monitoring', 'seo-monitoring', 'Diverse geo-locations for search engine ranking checks', 'seo_monitoring', 0.5, 0.8, 0.4, 1.0, true, 30, ARRAY['http', 'https'], 'standard')
ON CONFLICT (slug) DO NOTHING;

SELECT 'Proxy engine tables created successfully!' as status;

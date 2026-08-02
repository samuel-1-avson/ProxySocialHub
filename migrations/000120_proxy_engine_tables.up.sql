-- P2 MIG-02: promote proxy-engine tables (DDL + seeds; no RLS).
-- Use to_regclass guards to avoid pg_type unique_violation when a prior
-- orphaned composite type / partial create exists (IF NOT EXISTS is not enough).

DO $$
BEGIN
  IF to_regclass('public.service_configurations') IS NULL THEN
    CREATE TABLE public.service_configurations (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      node_id UUID NOT NULL REFERENCES public.nodes(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
      enable_http BOOLEAN DEFAULT TRUE,
      enable_https BOOLEAN DEFAULT TRUE,
      enable_socks5 BOOLEAN DEFAULT FALSE,
      enable_ssh_tunnel BOOLEAN DEFAULT FALSE,
      max_bandwidth_mbps INT DEFAULT 100,
      priority_tier VARCHAR(20) DEFAULT 'standard',
      allowed_countries TEXT[],
      blocked_countries TEXT[],
      allowed_cities TEXT[],
      max_concurrent_connections INT DEFAULT 10,
      max_daily_bandwidth_gb DOUBLE PRECISION DEFAULT 0,
      max_requests_per_minute INT DEFAULT 1000,
      allowed_ports INTEGER[],
      blocked_ports INTEGER[],
      allowed_domains TEXT[],
      blocked_domains TEXT[],
      captcha_solving_enabled BOOLEAN DEFAULT FALSE,
      captcha_price_per_solve DOUBLE PRECISION DEFAULT 0.002,
      captcha_provider_key VARCHAR(255),
      browser_fingerprint_enabled BOOLEAN DEFAULT FALSE,
      fingerprint_price_per_session DOUBLE PRECISION DEFAULT 0.01,
      javascript_render_enabled BOOLEAN DEFAULT FALSE,
      js_render_price_per_page DOUBLE PRECISION DEFAULT 0.005,
      screenshot_enabled BOOLEAN DEFAULT FALSE,
      screenshot_price_per_capture DOUBLE PRECISION DEFAULT 0.005,
      price_multiplier_http DOUBLE PRECISION DEFAULT 1.0,
      price_multiplier_https DOUBLE PRECISION DEFAULT 1.0,
      price_multiplier_socks5 DOUBLE PRECISION DEFAULT 1.2,
      price_multiplier_ssh DOUBLE PRECISION DEFAULT 1.5,
      price_multiplier_priority DOUBLE PRECISION DEFAULT 1.5,
      supports_sticky_session BOOLEAN DEFAULT TRUE,
      supports_auto_rotation BOOLEAN DEFAULT TRUE,
      min_rotation_interval_sec INT DEFAULT 60,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_svc_config_node ON public.service_configurations(node_id);
CREATE INDEX IF NOT EXISTS idx_svc_config_user ON public.service_configurations(user_id);
CREATE INDEX IF NOT EXISTS idx_svc_config_active ON public.service_configurations(is_active) WHERE is_active = TRUE;

DO $$
BEGIN
  IF to_regclass('public.session_configurations') IS NULL THEN
    CREATE TABLE public.session_configurations (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
      allowed_domains TEXT[],
      blocked_domains TEXT[],
      allowed_ports INTEGER[],
      blocked_ports INTEGER[],
      bandwidth_limit_gb DOUBLE PRECISION DEFAULT 0,
      request_limit INT DEFAULT 0,
      time_limit_minutes INT DEFAULT 0,
      rotation_type VARCHAR(20) DEFAULT 'none',
      rotation_interval_seconds INT DEFAULT 60,
      sticky_target VARCHAR(255),
      preferred_country VARCHAR(10),
      preferred_city VARCHAR(100),
      preferred_isp VARCHAR(100),
      min_quality_score DOUBLE PRECISION DEFAULT 0,
      max_latency_ms INT DEFAULT 0,
      preferred_protocol VARCHAR(20),
      use_captcha_solving BOOLEAN DEFAULT FALSE,
      use_javascript_render BOOLEAN DEFAULT FALSE,
      use_browser_fingerprint BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_config ON public.session_configurations(session_id);
CREATE INDEX IF NOT EXISTS idx_session_config_user ON public.session_configurations(user_id);

DO $$
BEGIN
  IF to_regclass('public.routing_profiles') IS NULL THEN
    CREATE TABLE public.routing_profiles (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name VARCHAR(100) NOT NULL,
      slug VARCHAR(50) NOT NULL UNIQUE,
      description TEXT,
      use_case VARCHAR(50),
      is_default BOOLEAN DEFAULT FALSE,
      is_active BOOLEAN DEFAULT TRUE,
      speed_weight DOUBLE PRECISION DEFAULT 0.5,
      stability_weight DOUBLE PRECISION DEFAULT 0.5,
      price_weight DOUBLE PRECISION DEFAULT 0.5,
      location_weight DOUBLE PRECISION DEFAULT 0.3,
      auto_rotation BOOLEAN DEFAULT FALSE,
      rotation_interval_seconds INT DEFAULT 300,
      auto_failover BOOLEAN DEFAULT TRUE,
      max_retries INT DEFAULT 3,
      recommended_protocols TEXT[],
      recommended_tier VARCHAR(20),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_routing_profile_use_case ON public.routing_profiles(use_case);
CREATE INDEX IF NOT EXISTS idx_routing_profile_active ON public.routing_profiles(is_active) WHERE is_active = TRUE;

INSERT INTO public.routing_profiles (
    name, slug, description, use_case,
    speed_weight, stability_weight, price_weight, location_weight,
    auto_rotation, rotation_interval_seconds, recommended_protocols, recommended_tier
) VALUES
('Web Scraping', 'web-scraping', 'Optimized for high-volume web scraping and data extraction', 'web_scraping', 0.7, 0.8, 0.5, 0.3, true, 60, ARRAY['http', 'https'], 'priority'),
('Social Media', 'social-media', 'Residential IPs for social media management', 'social_media', 0.4, 0.9, 0.3, 0.8, false, 300, ARRAY['http', 'https'], 'priority'),
('E-Commerce', 'e-commerce', 'Stable connections for price monitoring and checkout', 'e_commerce', 0.6, 0.9, 0.3, 0.5, true, 300, ARRAY['http', 'https'], 'standard'),
('Gaming', 'gaming', 'Low-latency connections for gaming and real-time apps', 'gaming', 0.95, 0.7, 0.2, 0.9, false, 0, ARRAY['socks5'], 'enterprise'),
('Streaming', 'streaming', 'High-bandwidth connections for video streaming', 'streaming', 0.95, 0.6, 0.3, 0.7, false, 0, ARRAY['socks5', 'http'], 'priority'),
('SEO Monitoring', 'seo-monitoring', 'Diverse geo-locations for search engine ranking checks', 'seo_monitoring', 0.5, 0.8, 0.4, 1.0, true, 30, ARRAY['http', 'https'], 'standard')
ON CONFLICT (slug) DO NOTHING;

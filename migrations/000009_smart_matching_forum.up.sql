-- =============================================
-- ProxySocialHub: Smart Matching & Forum
-- Final Features
-- =============================================

-- ============ Smart Matching ============

-- Use case categories for proxy recommendations
CREATE TABLE IF NOT EXISTS use_cases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    requirements JSONB DEFAULT '{}',  -- {min_speed: 10, regions: ["US", "EU"], etc}
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Default use cases
INSERT INTO use_cases (name, description, requirements) VALUES
    ('Web Scraping', 'High-volume data collection', '{"min_speed_mbps": 5, "rotating": true}'),
    ('Streaming', 'Video streaming and media access', '{"min_speed_mbps": 25, "stable": true}'),
    ('Gaming', 'Low latency gaming proxies', '{"max_latency_ms": 50, "stable": true}'),
    ('Social Media', 'Social media management', '{"rotating": true, "residential": true}'),
    ('SEO Research', 'Search engine monitoring', '{"rotating": true, "multi_region": true}'),
    ('Ad Verification', 'Advertising verification', '{"residential": true, "multi_region": true}'),
    ('E-Commerce', 'Price monitoring and purchasing', '{"residential": true, "stable": true}'),
    ('General Browsing', 'Anonymous browsing', '{"min_speed_mbps": 10}')
ON CONFLICT (name) DO NOTHING;

-- User preferences for matching
CREATE TABLE IF NOT EXISTS user_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    preferred_use_case UUID REFERENCES use_cases(id),
    preferred_regions TEXT[] DEFAULT '{}',
    max_price_per_gb NUMERIC(10,2),
    min_seller_rating NUMERIC(3,2),
    prefer_verified_sellers BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id)
);

-- ============ Community Forum ============

CREATE TABLE IF NOT EXISTS forum_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL UNIQUE,
    slug VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    icon VARCHAR(50),
    sort_order INT DEFAULT 0,
    is_locked BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Default categories
INSERT INTO forum_categories (name, slug, description, icon, sort_order) VALUES
    ('Announcements', 'announcements', 'Official platform news and updates', 'megaphone', 1),
    ('Getting Started', 'getting-started', 'New user guides and tutorials', 'book', 2),
    ('Provider Tips', 'provider-tips', 'Tips for bandwidth providers', 'server', 3),
    ('Buyer Guides', 'buyer-guides', 'Guides for proxy buyers', 'shopping-cart', 4),
    ('Technical Support', 'technical-support', 'Get help with technical issues', 'help-circle', 5),
    ('Feature Requests', 'feature-requests', 'Suggest new features', 'lightbulb', 6),
    ('General Discussion', 'general', 'Off-topic and community chat', 'message-circle', 7)
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS forum_threads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category_id UUID NOT NULL REFERENCES forum_categories(id),
    author_id UUID NOT NULL REFERENCES users(id),
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    is_pinned BOOLEAN DEFAULT FALSE,
    is_locked BOOLEAN DEFAULT FALSE,
    views_count INT DEFAULT 0,
    replies_count INT DEFAULT 0,
    last_reply_at TIMESTAMP WITH TIME ZONE,
    last_reply_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_threads_category ON forum_threads(category_id);
CREATE INDEX IF NOT EXISTS idx_threads_author ON forum_threads(author_id);
CREATE INDEX IF NOT EXISTS idx_threads_created ON forum_threads(created_at DESC);

CREATE TABLE IF NOT EXISTS forum_posts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    thread_id UUID NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    is_solution BOOLEAN DEFAULT FALSE,
    upvotes INT DEFAULT 0,
    downvotes INT DEFAULT 0,
    parent_id UUID REFERENCES forum_posts(id),  -- For nested replies
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_posts_thread ON forum_posts(thread_id);
CREATE INDEX IF NOT EXISTS idx_posts_author ON forum_posts(author_id);

CREATE TABLE IF NOT EXISTS forum_votes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    post_id UUID NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
    vote_type SMALLINT NOT NULL,  -- 1 = upvote, -1 = downvote
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, post_id)
);
CREATE INDEX IF NOT EXISTS idx_votes_post ON forum_votes(post_id);

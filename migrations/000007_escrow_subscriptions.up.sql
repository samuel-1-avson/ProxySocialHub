-- =============================================
-- ProxySocialHub: Escrow & Subscriptions
-- Phase 10: New Features
-- =============================================

-- Escrow Transactions
CREATE TABLE IF NOT EXISTS escrow_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id),
    buyer_id UUID NOT NULL REFERENCES users(id),
    seller_id UUID NOT NULL REFERENCES users(id),
    amount NUMERIC(20,4) NOT NULL,
    status VARCHAR(50) DEFAULT 'held',  -- held, released, refunded, disputed
    held_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    released_at TIMESTAMP WITH TIME ZONE,
    auto_release_at TIMESTAMP WITH TIME ZONE,  -- 7 days after held
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_escrow_order ON escrow_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_escrow_status ON escrow_transactions(status);
CREATE INDEX IF NOT EXISTS idx_escrow_auto_release ON escrow_transactions(auto_release_at) WHERE status = 'held';

-- Disputes
CREATE TABLE IF NOT EXISTS disputes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    escrow_id UUID NOT NULL REFERENCES escrow_transactions(id),
    order_id UUID NOT NULL REFERENCES orders(id),
    initiated_by UUID NOT NULL REFERENCES users(id),
    reason VARCHAR(50) NOT NULL,  -- quality, non_delivery, fraud, other
    description TEXT,
    evidence_urls JSONB DEFAULT '[]',
    status VARCHAR(50) DEFAULT 'open',  -- open, under_review, resolved_buyer, resolved_seller
    resolution TEXT,
    resolved_by UUID REFERENCES users(id),
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_disputes_escrow ON disputes(escrow_id);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status);

-- =============================================
-- Subscription Plans
-- =============================================

CREATE TABLE IF NOT EXISTS subscription_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    price_monthly NUMERIC(10,2) NOT NULL,
    price_yearly NUMERIC(10,2),
    features JSONB DEFAULT '{}',
    bandwidth_limit_gb INT,  -- NULL = unlimited
    listing_limit INT DEFAULT 5,
    priority_support BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default plans
INSERT INTO subscription_plans (name, description, price_monthly, price_yearly, features, bandwidth_limit_gb, listing_limit, priority_support) VALUES
    ('Free', 'Basic access to marketplace', 0, 0, '{"api_access": false, "analytics": false}', 10, 2, FALSE),
    ('Pro', 'For individual providers', 29.99, 299.99, '{"api_access": true, "analytics": true, "custom_pricing": true}', 500, 20, FALSE),
    ('Business', 'For teams and businesses', 99.99, 999.99, '{"api_access": true, "analytics": true, "custom_pricing": true, "team_members": 5}', NULL, 100, TRUE),
    ('Enterprise', 'Custom solutions', 299.99, 2999.99, '{"api_access": true, "analytics": true, "custom_pricing": true, "team_members": -1, "dedicated_support": true}', NULL, NULL, TRUE)
ON CONFLICT (name) DO NOTHING;

-- User Subscriptions
CREATE TABLE IF NOT EXISTS user_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    plan_id UUID NOT NULL REFERENCES subscription_plans(id),
    status VARCHAR(50) DEFAULT 'active',  -- active, cancelled, expired, past_due
    billing_cycle VARCHAR(20) DEFAULT 'monthly',  -- monthly, yearly
    current_period_start TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    current_period_end TIMESTAMP WITH TIME ZONE,
    cancelled_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON user_subscriptions(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_active ON user_subscriptions(user_id) WHERE status = 'active';

-- =============================================
-- Badge Awards Tracking
-- =============================================

-- Add milestone tracking to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS total_orders INT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS total_sales_count INT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS total_revenue NUMERIC(20,4) DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS consecutive_five_star_reviews INT DEFAULT 0;

-- Email Notification Preferences
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_notifications JSONB DEFAULT '{"orders": true, "reviews": true, "followers": true, "messages": true, "digest": false}';

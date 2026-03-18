-- SUBSCRIPTION PLANS (needed by migration 000051 seed data)
-- Created via GORM AutoMigrate in Supabase, never captured in a numbered migration.
CREATE TABLE IF NOT EXISTS subscription_plans (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                VARCHAR(100) UNIQUE NOT NULL,
    description         TEXT,
    price_monthly       NUMERIC(10,2) NOT NULL DEFAULT 0,
    price_yearly        NUMERIC(10,2),
    features            JSONB,
    bandwidth_limit_gb  INT,
    listing_limit       INT NOT NULL DEFAULT 5,
    priority_support    BOOLEAN NOT NULL DEFAULT FALSE,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

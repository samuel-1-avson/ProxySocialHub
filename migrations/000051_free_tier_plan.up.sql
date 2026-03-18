-- P3-11: Seed the "free" subscription plan so free-tier limits are DB-driven.
-- Use ON CONFLICT DO NOTHING so this is idempotent on re-run.
INSERT INTO subscription_plans (id, name, description, price_monthly, price_yearly,
    features, bandwidth_limit_gb, listing_limit, priority_support, is_active, created_at)
VALUES (
    gen_random_uuid(),
    'free',
    'Free tier — limited listings, no API access',
    0, 0,
    '{"api_access":false,"analytics":false,"custom_pricing":false,"team_members":0,"dedicated_support":false}',
    10,   -- 10 GB/month bandwidth
    2,    -- 2 marketplace listings
    false,
    true,
    NOW()
)
ON CONFLICT (name) DO UPDATE SET
    listing_limit      = EXCLUDED.listing_limit,
    bandwidth_limit_gb = EXCLUDED.bandwidth_limit_gb,
    features           = EXCLUDED.features;

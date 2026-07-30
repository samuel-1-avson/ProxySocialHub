-- Buyer subscription entitlements (#30): user_subscriptions + paid plan SKUs.
-- Provisional pricing pending product sign-off; retune via UPDATE without code changes.

CREATE TABLE IF NOT EXISTS user_subscriptions (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id              UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    plan_id              UUID NOT NULL REFERENCES subscription_plans(id),
    status               VARCHAR(50) NOT NULL DEFAULT 'active',
    billing_cycle        VARCHAR(20) NOT NULL DEFAULT 'monthly',
    current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    current_period_end   TIMESTAMPTZ,
    cancelled_at         TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_status
    ON user_subscriptions (user_id, status);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_period_end
    ON user_subscriptions (current_period_end)
    WHERE current_period_end IS NOT NULL;

-- Paid SKUs (provisional)
INSERT INTO subscription_plans (id, name, description, price_monthly, price_yearly,
    features, bandwidth_limit_gb, listing_limit, priority_support, is_active, created_at)
VALUES (
    gen_random_uuid(),
    'pro',
    'Pro — provisional SKU pending product sign-off. Higher listing + bandwidth caps with API access.',
    29, 290,
    '{"api_access":true,"analytics":true,"custom_pricing":false,"team_members":5,"dedicated_support":false}',
    200,
    25,
    false,
    true,
    NOW()
),
(
    gen_random_uuid(),
    'scale',
    'Scale — provisional SKU pending product sign-off. Unlimited listings/bandwidth with priority support.',
    99, 990,
    '{"api_access":true,"analytics":true,"custom_pricing":true,"team_members":-1,"dedicated_support":true}',
    NULL,
    0,
    true,
    true,
    NOW()
)
ON CONFLICT (name) DO UPDATE SET
    description        = EXCLUDED.description,
    price_monthly      = EXCLUDED.price_monthly,
    price_yearly       = EXCLUDED.price_yearly,
    features           = EXCLUDED.features,
    bandwidth_limit_gb = EXCLUDED.bandwidth_limit_gb,
    listing_limit      = EXCLUDED.listing_limit,
    priority_support   = EXCLUDED.priority_support,
    is_active          = EXCLUDED.is_active;

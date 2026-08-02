-- User onboarding progress (Phase 1)
CREATE TABLE IF NOT EXISTS user_onboarding (
    user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    intent VARCHAR(20),
    current_step VARCHAR(40) NOT NULL DEFAULT 'intent',
    steps JSONB NOT NULL DEFAULT '{}'::jsonb,
    completed_at TIMESTAMPTZ,
    dismissed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT user_onboarding_intent_check
        CHECK (intent IS NULL OR intent IN ('buyer', 'provider', 'both'))
);

CREATE INDEX IF NOT EXISTS idx_user_onboarding_current_step
    ON user_onboarding (current_step)
    WHERE completed_at IS NULL AND dismissed_at IS NULL;

CREATE TABLE IF NOT EXISTS onboarding_funnel_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schema_version TEXT NOT NULL DEFAULT 'onboarding.funnel.v1',
    event_name TEXT NOT NULL,
    user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    surface TEXT,
    meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_funnel_events_created_at
    ON onboarding_funnel_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_onboarding_funnel_events_event_name_created_at
    ON onboarding_funnel_events (event_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_onboarding_funnel_events_user_id
    ON onboarding_funnel_events (user_id)
    WHERE user_id IS NOT NULL;

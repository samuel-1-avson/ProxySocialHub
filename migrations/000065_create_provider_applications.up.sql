-- Creation of provider_applications table (automated version with no 'reason' field)
CREATE TABLE IF NOT EXISTS provider_applications (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL UNIQUE,
    isp         VARCHAR(255),
    location    VARCHAR(255),
    bandwidth   VARCHAR(100),
    status      VARCHAR(20) DEFAULT 'pending',
    reviewer_id UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add index for user_id lookup
CREATE INDEX IF NOT EXISTS idx_provider_applications_user_id ON provider_applications(user_id);

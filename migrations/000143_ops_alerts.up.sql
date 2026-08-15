-- Durable operator alert journal (S3 without SaaS Slack/PagerDuty).
-- Append-only ops surface: critical money/system alerts land here + NATS.
CREATE TABLE IF NOT EXISTS ops_alerts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    level           TEXT NOT NULL CHECK (level IN ('info', 'warning', 'critical')),
    title           TEXT NOT NULL,
    message         TEXT NOT NULL,
    source          TEXT NOT NULL DEFAULT 'control-api',
    fingerprint     TEXT,
    delivered_nats  BOOLEAN NOT NULL DEFAULT FALSE,
    delivered_hook   BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_ops_alerts_created_at ON ops_alerts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ops_alerts_level_created ON ops_alerts (level, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ops_alerts_fingerprint ON ops_alerts (fingerprint) WHERE fingerprint IS NOT NULL;

COMMENT ON TABLE ops_alerts IS
  'Platform-native alert journal. Prefer this + NATS over centralized SaaS (Slack/PagerDuty).';

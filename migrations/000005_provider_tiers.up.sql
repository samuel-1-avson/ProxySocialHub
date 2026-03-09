-- Provider verification tier system
CREATE TYPE provider_tier AS ENUM ('unverified', 'basic', 'verified', 'premium', 'enterprise');

ALTER TABLE provider_nodes ADD COLUMN IF NOT EXISTS tier provider_tier NOT NULL DEFAULT 'unverified';
ALTER TABLE provider_nodes ADD COLUMN IF NOT EXISTS tier_verified_at TIMESTAMPTZ;
ALTER TABLE provider_nodes ADD COLUMN IF NOT EXISTS tier_score NUMERIC(5,2) DEFAULT 0;
ALTER TABLE provider_nodes ADD COLUMN IF NOT EXISTS uptime_percent NUMERIC(5,2) DEFAULT 0;
ALTER TABLE provider_nodes ADD COLUMN IF NOT EXISTS total_sessions_served INT DEFAULT 0;
ALTER TABLE provider_nodes ADD COLUMN IF NOT EXISTS avg_latency_ms INT DEFAULT 0;
ALTER TABLE provider_nodes ADD COLUMN IF NOT EXISTS dispute_count INT DEFAULT 0;
ALTER TABLE provider_nodes ADD COLUMN IF NOT EXISTS kyc_verified BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_provider_nodes_tier ON provider_nodes(tier);
CREATE INDEX IF NOT EXISTS idx_provider_nodes_tier_score ON provider_nodes(tier_score DESC);

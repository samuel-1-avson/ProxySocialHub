CREATE TABLE IF NOT EXISTS proxy_assessments (
    id uuid PRIMARY KEY,
    seller_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    provider_node_id uuid NOT NULL REFERENCES provider_nodes(id) ON DELETE CASCADE,
    configuration_hash text NOT NULL,
    proxy_type text NOT NULL,
    protocol text NOT NULL,
    rotation_type text NOT NULL,
    country text NOT NULL DEFAULT '',
    max_concurrency integer NOT NULL,
    status text NOT NULL CHECK (status IN ('queued','running','passed','failed','unavailable')),
    policy_version text NOT NULL,
    quality_score double precision NOT NULL DEFAULT 0,
    tier text NOT NULL DEFAULT 'Unassessed',
    price_per_gb numeric(10,4) NOT NULL DEFAULT 0,
    confidence double precision NOT NULL DEFAULT 0,
    provisional boolean NOT NULL DEFAULT true,
    samples integer NOT NULL DEFAULT 0,
    successful_samples integer NOT NULL DEFAULT 0,
    latency_p50_ms double precision NOT NULL DEFAULT 0,
    latency_p95_ms double precision NOT NULL DEFAULT 0,
    throughput_mbps double precision NOT NULL DEFAULT 0,
    bytes_transferred bigint NOT NULL DEFAULT 0,
    summary text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    completed_at timestamptz,
    valid_until timestamptz
);
CREATE INDEX IF NOT EXISTS idx_proxy_assessments_queue ON proxy_assessments(status, created_at);
CREATE INDEX IF NOT EXISTS idx_proxy_assessments_owner_node ON proxy_assessments(seller_id, provider_node_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_proxy_assessments_one_pending ON proxy_assessments(provider_node_id) WHERE status IN ('queued','running');
ALTER TABLE proxy_listings ADD COLUMN IF NOT EXISTS quality_assessment_id uuid REFERENCES proxy_assessments(id) ON DELETE SET NULL;
-- Assessment data includes infrastructure evidence. Access is through the authenticated API.
ALTER TABLE proxy_assessments ENABLE ROW LEVEL SECURITY;

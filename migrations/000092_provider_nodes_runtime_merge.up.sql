-- Make provider_nodes the canonical runtime/product node table.
-- The legacy nodes table remains during this release as a compatibility mirror.

ALTER TABLE provider_nodes
    ADD COLUMN IF NOT EXISTS region varchar(100),
    ADD COLUMN IF NOT EXISTS isp varchar(100),
    ADD COLUMN IF NOT EXISTS connection_type varchar(50),
    ADD COLUMN IF NOT EXISTS port integer DEFAULT 0,
    ADD COLUMN IF NOT EXISTS protocol varchar(10) DEFAULT 'http',
    ADD COLUMN IF NOT EXISTS is_healthy boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS active_connections integer DEFAULT 0,
    ADD COLUMN IF NOT EXISTS max_connections integer DEFAULT 100,
    ADD COLUMN IF NOT EXISTS latency_ms integer DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_bytes_up bigint DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_bytes_down bigint DEFAULT 0,
    ADD COLUMN IF NOT EXISTS success_rate double precision DEFAULT 1.0,
    ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now(),
    ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_provider_nodes_gateway_identity
    ON provider_nodes (user_id, gateway_node_id)
    WHERE gateway_node_id IS NOT NULL AND gateway_node_id <> '';

CREATE INDEX IF NOT EXISTS idx_provider_nodes_runtime_health
    ON provider_nodes (status, is_healthy, active_connections, max_connections);

CREATE INDEX IF NOT EXISTS idx_provider_nodes_deleted_at
    ON provider_nodes (deleted_at);

-- Backfill existing dashboard rows from their linked gateway runtime row.
UPDATE provider_nodes pn
SET
    ip_address = COALESCE(NULLIF(pn.ip_address::text, '')::inet, NULLIF(n.ip_address, '')::inet),
    country = COALESCE(NULLIF(pn.country, ''), NULLIF(n.country_code, '')),
    city = COALESCE(NULLIF(pn.city, ''), NULLIF(n.city, '')),
    region = COALESCE(NULLIF(pn.region, ''), NULLIF(n.region, '')),
    isp = COALESCE(NULLIF(pn.isp, ''), NULLIF(n.isp, '')),
    connection_type = COALESCE(NULLIF(pn.connection_type, ''), NULLIF(n.connection_type, '')),
    port = COALESCE(NULLIF(pn.port, 0), n.port, 0),
    protocol = COALESCE(NULLIF(pn.protocol, ''), NULLIF(n.protocol, ''), 'http'),
    is_healthy = COALESCE(n.is_healthy, pn.status = 'online'),
    active_connections = COALESCE(n.active_connections, pn.active_connections, 0),
    max_connections = COALESCE(n.max_connections, pn.max_connections, 100),
    latency_ms = COALESCE(n.latency_ms, pn.latency_ms, pn.avg_latency_ms, 0),
    total_bytes_up = COALESCE(n.total_bytes_up, pn.total_bytes_up, 0),
    total_bytes_down = COALESCE(n.total_bytes_down, pn.total_bytes_down, 0),
    uptime_percent = COALESCE(NULLIF(pn.uptime_percent, 0), n.uptime_percent, 0),
    quality_score = COALESCE(NULLIF(pn.quality_score, 0), n.quality_score, 100),
    base_price_per_gb = COALESCE(NULLIF(pn.base_price_per_gb, 0), n.base_price_per_gb, 0.20),
    last_seen_at = COALESCE(pn.last_seen_at, n.last_seen_at),
    updated_at = now()
FROM nodes n
WHERE n.provider_node_id = pn.id
   OR (pn.gateway_node_id IS NOT NULL AND pn.gateway_node_id <> '' AND n.gateway_node_id = pn.gateway_node_id);

-- Create canonical provider_nodes for orphan gateway rows so runtime identity is not lost.
INSERT INTO provider_nodes (
    id,
    user_id,
    name,
    ip_address,
    country,
    city,
    region,
    isp,
    connection_type,
    port,
    protocol,
    status,
    is_healthy,
    active_connections,
    max_connections,
    latency_ms,
    total_bytes_up,
    total_bytes_down,
    uptime_percent,
    quality_score,
    base_price_per_gb,
    last_seen_at,
    gateway_node_id,
    created_at,
    updated_at
)
SELECT
    COALESCE(n.provider_node_id, uuid_generate_v4()),
    COALESCE(NULLIF(n.provider_user_id, '00000000-0000-0000-0000-000000000000'::uuid), n.user_id),
    COALESCE(NULLIF(n.gateway_node_id, ''), 'Gateway Node'),
    NULLIF(n.ip_address, '')::inet,
    NULLIF(n.country_code, ''),
    NULLIF(n.city, ''),
    NULLIF(n.region, ''),
    NULLIF(n.isp, ''),
    NULLIF(n.connection_type, ''),
    COALESCE(n.port, 0),
    COALESCE(NULLIF(n.protocol, ''), 'http'),
    CASE WHEN n.is_healthy THEN 'online' ELSE 'offline' END,
    n.is_healthy,
    COALESCE(n.active_connections, 0),
    COALESCE(n.max_connections, 100),
    COALESCE(n.latency_ms, 0),
    COALESCE(n.total_bytes_up, 0),
    COALESCE(n.total_bytes_down, 0),
    COALESCE(n.uptime_percent, 0),
    COALESCE(n.quality_score, 100),
    COALESCE(n.base_price_per_gb, 0.20),
    n.last_seen_at,
    NULLIF(n.gateway_node_id, ''),
    COALESCE(n.created_at, now()),
    now()
FROM nodes n
LEFT JOIN provider_nodes pn
    ON pn.id = n.provider_node_id
    OR (n.gateway_node_id IS NOT NULL AND n.gateway_node_id <> '' AND pn.gateway_node_id = n.gateway_node_id)
WHERE pn.id IS NULL;

-- Keep legacy rows linked to their canonical provider_nodes during the compatibility window.
UPDATE nodes n
SET provider_node_id = pn.id
FROM provider_nodes pn
WHERE n.provider_node_id IS NULL
  AND n.gateway_node_id IS NOT NULL
  AND n.gateway_node_id <> ''
  AND pn.gateway_node_id = n.gateway_node_id;

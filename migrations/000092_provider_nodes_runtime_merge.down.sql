DROP INDEX IF EXISTS idx_provider_nodes_runtime_health;
DROP INDEX IF EXISTS idx_provider_nodes_gateway_identity;
DROP INDEX IF EXISTS idx_provider_nodes_deleted_at;

ALTER TABLE provider_nodes
    DROP COLUMN IF EXISTS success_rate,
    DROP COLUMN IF EXISTS total_bytes_down,
    DROP COLUMN IF EXISTS total_bytes_up,
    DROP COLUMN IF EXISTS latency_ms,
    DROP COLUMN IF EXISTS max_connections,
    DROP COLUMN IF EXISTS active_connections,
    DROP COLUMN IF EXISTS is_healthy,
    DROP COLUMN IF EXISTS protocol,
    DROP COLUMN IF EXISTS port,
    DROP COLUMN IF EXISTS connection_type,
    DROP COLUMN IF EXISTS isp,
    DROP COLUMN IF EXISTS region,
    DROP COLUMN IF EXISTS deleted_at,
    DROP COLUMN IF EXISTS updated_at;

-- E2: Provider leaderboard materialised view.
-- Aggregates per-provider stats from nodes, sessions, and provider_earnings
-- into a single pre-computed row for fast leaderboard queries.
-- Refresh is safe to run with CONCURRENTLY (no read lock during refresh).

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_provider_leaderboard AS
SELECT
    n.provider_user_id                              AS provider_id,
    COUNT(DISTINCT n.id)                            AS node_count,
    ROUND(AVG(n.uptime_percent)::NUMERIC, 2)        AS avg_uptime_pct,
    ROUND(AVG(n.quality_score)::NUMERIC, 2)         AS avg_quality_score,
    ROUND(AVG(n.latency_ms)::NUMERIC, 0)            AS avg_latency_ms,
    ROUND(AVG(n.success_rate)::NUMERIC, 4)          AS avg_success_rate,
    COUNT(DISTINCT n.id)
        FILTER (WHERE n.is_healthy AND n.deleted_at IS NULL) AS healthy_node_count,
    COALESCE(SUM(pe.net_sol), 0)                    AS total_earnings_sol,
    COALESCE(SUM(CASE WHEN pe.status = 'paid' THEN pe.net_sol END), 0) AS paid_earnings_sol,
    COUNT(DISTINCT s.id)                            AS total_sessions,
    COALESCE(SUM(s.bytes_used), 0)                  AS total_bytes_served,
    NOW()                                           AS refreshed_at
FROM nodes n
LEFT JOIN sessions  s  ON s.node_id   = n.id  AND s.deleted_at IS NULL
LEFT JOIN provider_earnings pe ON pe.provider_id = n.provider_user_id
WHERE n.deleted_at IS NULL
GROUP BY n.provider_user_id
WITH DATA;

-- Unique index required for CONCURRENTLY refresh
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_provider_leaderboard_provider_id
    ON mv_provider_leaderboard (provider_id);

-- Secondary sort index for common query patterns
CREATE INDEX IF NOT EXISTS idx_mv_provider_leaderboard_quality
    ON mv_provider_leaderboard (avg_quality_score DESC);
CREATE INDEX IF NOT EXISTS idx_mv_provider_leaderboard_earnings
    ON mv_provider_leaderboard (total_earnings_sol DESC);

COMMENT ON MATERIALIZED VIEW mv_provider_leaderboard IS
    'Pre-aggregated provider stats for leaderboard API. '
    'Refresh periodically via: REFRESH MATERIALIZED VIEW CONCURRENTLY mv_provider_leaderboard';

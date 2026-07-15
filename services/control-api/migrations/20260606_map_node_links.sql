-- Aggregated map topology edges (region-pair session routes).
CREATE TABLE IF NOT EXISTS map_node_links (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    link_kind       VARCHAR(32) NOT NULL,
    source_kind     VARCHAR(16) NOT NULL,
    source_id       VARCHAR(120) NOT NULL,
    source_lat      DOUBLE PRECISION NOT NULL,
    source_lon      DOUBLE PRECISION NOT NULL,
    target_kind     VARCHAR(16) NOT NULL,
    target_id       VARCHAR(120) NOT NULL,
    target_lat      DOUBLE PRECISION NOT NULL,
    target_lon      DOUBLE PRECISION NOT NULL,
    active_sessions INT NOT NULL DEFAULT 0,
    bytes_up_1h     BIGINT NOT NULL DEFAULT 0,
    bytes_down_1h   BIGINT NOT NULL DEFAULT 0,
    latency_ms_p50  INT,
    latency_ms_p95  INT,
    geo_precision   VARCHAR(16) NOT NULL DEFAULT 'region_hub',
    provenance      VARCHAR(32) NOT NULL,
    window_start    TIMESTAMPTZ NOT NULL,
    window_end      TIMESTAMPTZ NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (link_kind, source_id, target_id, window_start)
);

CREATE INDEX IF NOT EXISTS idx_map_node_links_window ON map_node_links (window_end DESC);
CREATE INDEX IF NOT EXISTS idx_map_node_links_active ON map_node_links (active_sessions DESC);

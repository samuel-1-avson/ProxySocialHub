-- Map viewport indexes for SQL bbox filtering on explorer_nodes.
CREATE INDEX IF NOT EXISTS idx_explorer_nodes_lat_lon
    ON explorer_nodes (latitude, longitude)
    WHERE ABS(latitude) > 0.01 OR ABS(longitude) > 0.01;

CREATE INDEX IF NOT EXISTS idx_explorer_nodes_active_lat_lon
    ON explorer_nodes (is_active, latitude, longitude)
    WHERE is_active = true AND (ABS(latitude) > 0.01 OR ABS(longitude) > 0.01);

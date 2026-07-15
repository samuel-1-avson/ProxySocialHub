-- Mirror of migrations/000098_explorer_node_geo_source.up.sql
ALTER TABLE explorer_nodes
    ADD COLUMN IF NOT EXISTS geo_source VARCHAR(32) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS geo_resolved_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_explorer_nodes_geo_source
    ON explorer_nodes (geo_source)
    WHERE geo_source <> '';

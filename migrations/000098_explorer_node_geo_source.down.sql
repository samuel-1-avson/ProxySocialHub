DROP INDEX IF EXISTS idx_explorer_nodes_geo_source;

ALTER TABLE explorer_nodes
    DROP COLUMN IF EXISTS geo_resolved_at,
    DROP COLUMN IF EXISTS geo_source;

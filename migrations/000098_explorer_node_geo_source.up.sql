-- Persist map resolver output on explorer_nodes for enrich-time provenance and staleness checks.
ALTER TABLE explorer_nodes
    ADD COLUMN IF NOT EXISTS geo_source VARCHAR(32) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS geo_resolved_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_explorer_nodes_geo_source
    ON explorer_nodes (geo_source)
    WHERE geo_source <> '';

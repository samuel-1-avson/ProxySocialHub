-- Link dashboard provider_nodes with gateway nodes registry.

ALTER TABLE provider_nodes
    ADD COLUMN IF NOT EXISTS gateway_node_id VARCHAR(128);

CREATE INDEX IF NOT EXISTS idx_provider_nodes_gateway_node_id
    ON provider_nodes (user_id, gateway_node_id)
    WHERE gateway_node_id IS NOT NULL AND gateway_node_id <> '';

ALTER TABLE nodes
    ADD COLUMN IF NOT EXISTS provider_node_id UUID REFERENCES provider_nodes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_nodes_provider_node_id ON nodes (provider_node_id);

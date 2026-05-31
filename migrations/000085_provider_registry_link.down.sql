DROP INDEX IF EXISTS idx_nodes_provider_node_id;
ALTER TABLE nodes DROP COLUMN IF EXISTS provider_node_id;

DROP INDEX IF EXISTS idx_provider_nodes_gateway_node_id;
ALTER TABLE provider_nodes DROP COLUMN IF EXISTS gateway_node_id;

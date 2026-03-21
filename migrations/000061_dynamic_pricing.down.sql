DROP INDEX IF EXISTS idx_nodes_tier;

ALTER TABLE nodes 
DROP COLUMN IF EXISTS current_tier,
DROP COLUMN IF EXISTS base_price_per_gb;

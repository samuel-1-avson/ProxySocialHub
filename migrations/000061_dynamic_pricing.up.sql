ALTER TABLE nodes 
ADD COLUMN IF NOT EXISTS current_tier VARCHAR(50) DEFAULT 'Bronze',
ADD COLUMN IF NOT EXISTS base_price_per_gb DECIMAL(10,4) DEFAULT 0.20;

CREATE INDEX IF NOT EXISTS idx_nodes_tier ON nodes (current_tier);

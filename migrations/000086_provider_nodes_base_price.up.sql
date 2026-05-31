-- GORM ProviderNode.BasePricePerGB; 000061 only added this column on nodes.
ALTER TABLE provider_nodes
    ADD COLUMN IF NOT EXISTS base_price_per_gb DECIMAL(10,4) NOT NULL DEFAULT 0.20;

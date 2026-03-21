-- Create explorer_metrics table for network analytics and charts
-- This table stores aggregated network metrics by time period for the explorer dashboard

CREATE TABLE IF NOT EXISTS explorer_metrics (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chain                VARCHAR(20)  NOT NULL,
    period               VARCHAR(20)  NOT NULL, -- "hourly", "daily", "weekly"
    period_start         TIMESTAMPTZ  NOT NULL,
    total_transactions   BIGINT       NOT NULL DEFAULT 0,
    total_volume         NUMERIC(30,8) NOT NULL DEFAULT 0,
    active_wallets       BIGINT       NOT NULL DEFAULT 0,
    active_nodes         BIGINT       NOT NULL DEFAULT 0,
    average_block_time   NUMERIC(10,4) NOT NULL DEFAULT 0,
    total_bandwidth_bytes BIGINT      NOT NULL DEFAULT 0,
    total_fees           NUMERIC(20,8) NOT NULL DEFAULT 0,
    avg_tx_fee           NUMERIC(20,8) NOT NULL DEFAULT 0,
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    
    -- Unique constraint to prevent duplicate metrics for same chain/period/time
    CONSTRAINT uq_explorer_metrics_chain_period_start UNIQUE (chain, period, period_start)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_explorer_metrics_chain_period 
    ON explorer_metrics (chain, period);
    
CREATE INDEX IF NOT EXISTS idx_explorer_metrics_period_start 
    ON explorer_metrics (period_start DESC);
    
CREATE INDEX IF NOT EXISTS idx_explorer_metrics_chain_period_start 
    ON explorer_metrics (chain, period, period_start DESC);

-- Insert initial seed data to prevent empty charts
-- Current data based on existing node
INSERT INTO explorer_metrics (
    chain, 
    period, 
    period_start, 
    total_transactions, 
    total_volume, 
    active_wallets, 
    active_nodes, 
    average_block_time, 
    total_bandwidth_bytes, 
    total_fees, 
    avg_tx_fee
)
VALUES (
    'solana',
    'hourly',
    DATE_TRUNC('hour', NOW()),
    0,      -- total_transactions
    0,      -- total_volume
    1,      -- active_wallets (estimated)
    1,      -- active_nodes (from explorer_nodes)
    400,    -- average_block_time_ms (Solana typical)
    0,      -- total_bandwidth_bytes
    0,      -- total_fees
    0       -- avg_tx_fee
)
ON CONFLICT (chain, period, period_start) DO NOTHING;

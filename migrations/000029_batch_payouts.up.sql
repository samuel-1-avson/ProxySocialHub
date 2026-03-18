-- Migration: Batch Payout Processing
-- Description: Adds tables for efficient batch payout processing with gas savings
-- Created: 2026-03-14

-- 1. Create batch_payouts table
CREATE TABLE IF NOT EXISTS batch_payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    total_amount DECIMAL(20,9) NOT NULL,
    total_count INT NOT NULL,
    success_count INT NOT NULL DEFAULT 0,
    failed_count INT NOT NULL DEFAULT 0,
    tx_hash VARCHAR(128),
    gas_fee_lamports BIGINT NOT NULL DEFAULT 0,
    processed_at TIMESTAMP,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Create batch_payout_items table
CREATE TABLE IF NOT EXISTS batch_payout_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL,
    provider_id UUID NOT NULL,
    wallet_address VARCHAR(64) NOT NULL,
    amount_sol DECIMAL(20,9) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_batch_item_batch FOREIGN KEY (batch_id) REFERENCES batch_payouts(id) ON DELETE CASCADE,
    CONSTRAINT fk_batch_item_provider FOREIGN KEY (provider_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 3. Create pending_payouts table (queue)
CREATE TABLE IF NOT EXISTS pending_payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL,
    wallet_address VARCHAR(64) NOT NULL,
    amount_sol DECIMAL(20,9) NOT NULL,
    priority INT NOT NULL DEFAULT 0,
    queued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    scheduled_for TIMESTAMP,
    attempts INT NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_pending_provider FOREIGN KEY (provider_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 4. Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_batch_payouts_status ON batch_payouts(status);
CREATE INDEX IF NOT EXISTS idx_batch_payouts_created ON batch_payouts(created_at);
CREATE INDEX IF NOT EXISTS idx_batch_items_batch ON batch_payout_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_items_provider ON batch_payout_items(provider_id);
CREATE INDEX IF NOT EXISTS idx_batch_items_status ON batch_payout_items(status);
CREATE INDEX IF NOT EXISTS idx_pending_provider ON pending_payouts(provider_id);
CREATE INDEX IF NOT EXISTS idx_pending_priority ON pending_payouts(priority DESC, queued_at ASC);
CREATE INDEX IF NOT EXISTS idx_pending_scheduled ON pending_payouts(scheduled_for) WHERE scheduled_for IS NOT NULL;

-- 5. Add comments
COMMENT ON TABLE batch_payouts IS 'Records of batched payout transactions for gas efficiency';
COMMENT ON TABLE batch_payout_items IS 'Individual payouts within a batch';
COMMENT ON TABLE pending_payouts IS 'Queue of payouts waiting to be batched';
COMMENT ON COLUMN batch_payouts.status IS 'pending, processing, completed, partial, failed';
COMMENT ON COLUMN pending_payouts.priority IS 'Higher values are processed first (based on amount)';

-- Add migration tracking
INSERT INTO schema_migrations (version, description) 
VALUES (29, 'Add batch payout processing tables');

-- Migration: Add Spending Limits Feature
-- Description: Adds spending limit tracking to wallets and creates spending records table
-- Created: 2026-03-14

-- 1. Add spending limit columns to wallets table
ALTER TABLE wallets 
    ADD COLUMN IF NOT EXISTS daily_limit DECIMAL(20,9) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS weekly_limit DECIMAL(20,9) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS monthly_limit DECIMAL(20,9) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS limit_window_start TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- 2. Create spending records table for tracking
CREATE TABLE IF NOT EXISTS spending_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    wallet_id UUID NOT NULL,
    amount DECIMAL(20,9) NOT NULL,
    type VARCHAR(20) NOT NULL,
    reference VARCHAR(128),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Indexes for efficient queries
    CONSTRAINT fk_spending_user FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_spending_wallet FOREIGN KEY (wallet_id) REFERENCES wallets(id) ON DELETE CASCADE
);

-- 3. Create indexes for spending queries
CREATE INDEX IF NOT EXISTS idx_spending_user_time ON spending_records(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_spending_type ON spending_records(type);
CREATE INDEX IF NOT EXISTS idx_spending_created ON spending_records(created_at);

-- 4. Set default limits for existing wallets based on trust tier
-- New users get conservative defaults
UPDATE wallets 
SET daily_limit = 10.0,
    weekly_limit = 50.0,
    monthly_limit = 100.0
WHERE daily_limit = 0 AND weekly_limit = 0 AND monthly_limit = 0;

-- 5. Add comments
COMMENT ON TABLE spending_records IS 'Tracks individual spending transactions for limit enforcement';
COMMENT ON COLUMN wallets.daily_limit IS 'Maximum SOL that can be spent per day (0 = unlimited)';
COMMENT ON COLUMN wallets.weekly_limit IS 'Maximum SOL that can be spent per week (0 = unlimited)';
COMMENT ON COLUMN wallets.monthly_limit IS 'Maximum SOL that can be spent per month (0 = unlimited)';

-- Add migration tracking
-- INSERT INTO schema_migrations (version, description) 
-- VALUES (28, 'Add spending limits feature');

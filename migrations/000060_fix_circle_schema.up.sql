-- Migration: Fix Circle and CircleMember schema mismatch
-- Created: 2026-03-20

-- 1. FIX circles table
ALTER TABLE circles ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) DEFAULT 'private';
ALTER TABLE circles ADD COLUMN IF NOT EXISTS member_count INT DEFAULT 0;
ALTER TABLE circles ADD COLUMN IF NOT EXISTS is_enterprise BOOLEAN DEFAULT false;
ALTER TABLE circles ADD COLUMN IF NOT EXISTS price_per_gb NUMERIC DEFAULT 0.50;
ALTER TABLE circles ADD COLUMN IF NOT EXISTS priority_level INT DEFAULT 0;
ALTER TABLE circles ADD COLUMN IF NOT EXISTS bandwidth_pool_gb NUMERIC DEFAULT 0.0;
ALTER TABLE circles ADD COLUMN IF NOT EXISTS bandwidth_used_gb NUMERIC DEFAULT 0.0;
ALTER TABLE circles ADD COLUMN IF NOT EXISTS revenue_share_percent NUMERIC DEFAULT 0.0;
ALTER TABLE circles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Migrate is_public to visibility
UPDATE circles SET visibility = 'public' WHERE is_public = true AND visibility = 'private';

-- 2. FIX circle_members table
-- Add id column if missing (GORM expects id primary key)
ALTER TABLE circle_members ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();

-- Add missing columns
ALTER TABLE circle_members ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';
ALTER TABLE circle_members ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE circle_members ADD COLUMN IF NOT EXISTS contributed_bandwidth_gb NUMERIC DEFAULT 0.0;
ALTER TABLE circle_members ADD COLUMN IF NOT EXISTS last_assigned_at TIMESTAMPTZ;

-- If circle_members has a composite primary key, we might want to change it to use 'id' 
-- but that can be risky if other tables reference it. 
-- However, according to psql output, it's just referenced by itself and has a PK on (circle_id, user_id).
-- Let's just make sure 'id' is populated and has a unique index for now.
CREATE UNIQUE INDEX IF NOT EXISTS idx_circle_members_id ON circle_members(id);

-- GORM will handle the rest once the columns exist.

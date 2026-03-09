-- Migration: Forum Reports
-- Created: March 9, 2026

-- ============================================
-- Forum Reports Table
-- ============================================
CREATE TABLE IF NOT EXISTS forum_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reporter_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    
    -- Target can be either a thread or a post
    thread_id UUID REFERENCES forum_threads(id) ON DELETE CASCADE,
    post_id UUID REFERENCES forum_posts(id) ON DELETE CASCADE,
    
    -- Report details
    reason VARCHAR(50) NOT NULL,
    details TEXT,
    
    -- Status tracking
    status VARCHAR(20) DEFAULT 'pending', -- pending, resolved, dismissed
    
    -- Resolution tracking
    resolved_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ,
    resolution_notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Ensure at least one target is specified
    CONSTRAINT chk_report_target CHECK (
        (thread_id IS NOT NULL AND post_id IS NULL) OR 
        (thread_id IS NULL AND post_id IS NOT NULL)
    )
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_forum_reports_reporter ON forum_reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_forum_reports_thread ON forum_reports(thread_id) WHERE thread_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_forum_reports_post ON forum_reports(post_id) WHERE post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_forum_reports_status ON forum_reports(status);
CREATE INDEX IF NOT EXISTS idx_forum_reports_created ON forum_reports(created_at DESC);

-- ============================================
-- Update Trigger for updated_at
-- ============================================
CREATE OR REPLACE FUNCTION update_forum_reports_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_forum_reports_updated_at ON forum_reports;
CREATE TRIGGER trg_forum_reports_updated_at
    BEFORE UPDATE ON forum_reports
    FOR EACH ROW
    EXECUTE FUNCTION update_forum_reports_updated_at();

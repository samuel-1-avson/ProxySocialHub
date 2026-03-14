-- N-06: Add soft-delete support to sessions and nodes tables.
-- GORM will automatically add WHERE deleted_at IS NULL to all queries
-- for models that embed gorm.DeletedAt once these columns exist.

ALTER TABLE public.sessions
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_deleted_at
    ON public.sessions (deleted_at)
    WHERE deleted_at IS NULL;

ALTER TABLE public.nodes
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_nodes_deleted_at
    ON public.nodes (deleted_at)
    WHERE deleted_at IS NULL;

-- Partial indexes on the status columns so active-only queries stay fast
-- even as the tables grow with soft-deleted rows.
CREATE INDEX IF NOT EXISTS idx_sessions_active
    ON public.sessions (user_id, status)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_nodes_healthy
    ON public.nodes (status)
    WHERE deleted_at IS NULL;

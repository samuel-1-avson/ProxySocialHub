DROP INDEX IF EXISTS public.idx_notifications_dedup;

-- Intentionally leave CASCADE FKs in place (safe; data-preserving).
-- Restoring prior SET NULL / missing FKs is environment-specific.

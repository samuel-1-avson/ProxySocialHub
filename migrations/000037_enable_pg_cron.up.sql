-- 000037: Ensure pg_cron is enabled and the audit partition job is scheduled.
--
-- pg_cron is a Supabase-supported extension. On Supabase, enable it from:
--   Dashboard → Database → Extensions → pg_cron
-- On self-hosted PostgreSQL, install it via your package manager and add
--   shared_preload_libraries = 'pg_cron'  to postgresql.conf, then restart.
--
-- This migration is IDEMPOTENT and safe to run even if pg_cron is not installed;
-- the DO block catches the error and prints a warning instead of failing.

-- 1. Try to enable the extension (no-op if already enabled, warning if unavailable).
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    RAISE NOTICE 'pg_cron extension is enabled.';
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING 'pg_cron is not available on this instance (%). '
                      'Audit log partitions must be created manually each month. '
                      'See migrations/000011_audit_log_partitioning.up.sql for details.', SQLERRM;
END $$;

-- 2. (Re-)schedule the monthly audit partition creation job.
--    Runs on the 25th of each month at 00:00 UTC, creating the following month''s partition.
--    Wrapped in a guard so the migration succeeds even without pg_cron.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        -- Remove stale job if already scheduled (prevents duplicate on re-run)
        BEGIN
            PERFORM cron.unschedule('create_audit_partition');
        EXCEPTION WHEN OTHERS THEN
            NULL; -- job did not exist — that's fine
        END;

        PERFORM cron.schedule(
            'create_audit_partition',
            '0 0 25 * *',
            $$SELECT create_audit_partition_if_not_exists()$$
        );
        RAISE NOTICE 'pg_cron job ''create_audit_partition'' scheduled (runs 25th of each month at 00:00 UTC).';
    ELSE
        RAISE NOTICE 'pg_cron not enabled — skipping job scheduling.';
    END IF;
END $$;

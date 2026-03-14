-- ============================================================
-- Migration 000011: Enable audit_logs monthly partitioning
-- ============================================================
-- Prerequisites: the create_audit_partition_if_not_exists()
-- function and audit_logs_partitioned table must already exist
-- (created in 20260121_soft_deletes_partitioning.sql).
-- Run this in the Supabase SQL Editor or via psql.
-- ============================================================

-- 1. Create partitions for the current and next month so queries
--    never hit the default/unpartitioned fallback.
DO $$
DECLARE
    this_month DATE := date_trunc('month', NOW())::DATE;
    next_month DATE := (date_trunc('month', NOW()) + INTERVAL '1 month')::DATE;
    month_after DATE := (date_trunc('month', NOW()) + INTERVAL '2 months')::DATE;
    tbl_name TEXT;
BEGIN
    -- Current month
    tbl_name := 'audit_logs_' || to_char(this_month, 'YYYY_MM');
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_logs_partitioned
         FOR VALUES FROM (%L) TO (%L)',
        tbl_name, this_month, next_month
    );
    RAISE NOTICE 'Ensured partition: %', tbl_name;

    -- Next month (pre-created so inserts never land in the default partition)
    tbl_name := 'audit_logs_' || to_char(next_month, 'YYYY_MM');
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_logs_partitioned
         FOR VALUES FROM (%L) TO (%L)',
        tbl_name, next_month, month_after
    );
    RAISE NOTICE 'Ensured partition: %', tbl_name;
END $$;

-- 2. Schedule the auto-partition function with pg_cron (runs on the
--    25th of each month at midnight UTC, creating the following month's partition).
--    Requires pg_cron extension.  Wrap in a DO block so the migration
--    succeeds even if pg_cron is not installed (e.g. local dev).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        -- Remove old job if it exists to avoid duplicates
        PERFORM cron.unschedule('create_audit_partition')
        WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'create_audit_partition');

        PERFORM cron.schedule(
            'create_audit_partition',
            '0 0 25 * *',
            'SELECT create_audit_partition_if_not_exists()'
        );
        RAISE NOTICE 'pg_cron job ''create_audit_partition'' scheduled (runs 25th of each month).';
    ELSE
        RAISE NOTICE 'pg_cron not available — partition job NOT scheduled. Run manually each month or install pg_cron.';
    END IF;
END $$;

-- 3. Verify
SELECT
    inhrelid::regclass AS partition_table,
    pg_get_expr(c.relpartbound, c.oid) AS bounds
FROM pg_inherits i
JOIN pg_class c ON c.oid = i.inhrelid
WHERE i.inhparent = 'audit_logs_partitioned'::regclass
ORDER BY partition_table;

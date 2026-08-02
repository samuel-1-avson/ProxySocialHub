-- P1 PART-01: explorer_transactions monthly partition maintenance.
-- Pre-create months through 2026-12 and schedule pg_cron when available.

CREATE OR REPLACE FUNCTION public.create_explorer_partition_if_not_exists()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    this_month DATE := date_trunc('month', NOW())::DATE;
    next_month DATE := (date_trunc('month', NOW()) + INTERVAL '1 month')::DATE;
    month_after DATE := (date_trunc('month', NOW()) + INTERVAL '2 months')::DATE;
    tbl_name TEXT;
BEGIN
    -- Current month
    tbl_name := 'explorer_transactions_y' || to_char(this_month, 'YYYYmMM');
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF public.explorer_transactions
         FOR VALUES FROM (%L) TO (%L)',
        tbl_name, this_month, next_month
    );

    -- Next month (pre-created so inserts never land in DEFAULT)
    tbl_name := 'explorer_transactions_y' || to_char(next_month, 'YYYYmMM');
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF public.explorer_transactions
         FOR VALUES FROM (%L) TO (%L)',
        tbl_name, next_month, month_after
    );
END;
$$;

COMMENT ON FUNCTION public.create_explorer_partition_if_not_exists() IS
'Ensures current + next month partitions exist for explorer_transactions (PART-01).';

-- Immediately ensure Sep–Dec 2026 (and any earlier missing months after Aug).
DO $$
DECLARE
    start_month DATE := DATE '2026-09-01';
    end_month DATE := DATE '2027-01-01';
    cur DATE;
    nxt DATE;
    tbl_name TEXT;
BEGIN
    IF to_regclass('public.explorer_transactions') IS NULL THEN
        RAISE NOTICE 'explorer_transactions missing — skip partition create';
        RETURN;
    END IF;

    cur := start_month;
    WHILE cur < end_month LOOP
        nxt := (cur + INTERVAL '1 month')::DATE;
        tbl_name := 'explorer_transactions_y' || to_char(cur, 'YYYYmMM');
        BEGIN
            EXECUTE format(
                'CREATE TABLE IF NOT EXISTS %I PARTITION OF public.explorer_transactions
                 FOR VALUES FROM (%L) TO (%L)',
                tbl_name, cur, nxt
            );
            RAISE NOTICE 'Ensured partition: %', tbl_name;
        EXCEPTION
            WHEN duplicate_table THEN
                RAISE NOTICE 'Partition already exists: %', tbl_name;
            WHEN others THEN
                -- Overlap with DEFAULT or existing bound: surface and continue
                RAISE NOTICE 'Could not create %: %', tbl_name, SQLERRM;
        END;
        cur := nxt;
    END LOOP;

    -- Also ensure current/next relative to NOW()
    PERFORM public.create_explorer_partition_if_not_exists();
END $$;

-- Schedule monthly maintenance when pg_cron is available.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        BEGIN
            PERFORM cron.unschedule('create_explorer_partition');
        EXCEPTION
            WHEN others THEN
                NULL; -- job may not exist
        END;

        PERFORM cron.schedule(
            'create_explorer_partition',
            '0 0 25 * *',
            'SELECT public.create_explorer_partition_if_not_exists()'
        );
        RAISE NOTICE 'pg_cron job create_explorer_partition scheduled (25th monthly).';
    ELSE
        RAISE NOTICE 'pg_cron not available — explorer partition job NOT scheduled.';
    END IF;
END $$;

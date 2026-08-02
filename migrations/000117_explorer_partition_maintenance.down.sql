-- Reverse PART-01 explorer partition maintenance.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        BEGIN
            PERFORM cron.unschedule('create_explorer_partition');
        EXCEPTION
            WHEN others THEN
                NULL;
        END;
    END IF;
END $$;

DROP FUNCTION IF EXISTS public.create_explorer_partition_if_not_exists();

-- Intentionally leave created monthly partitions in place (safe; data-preserving).

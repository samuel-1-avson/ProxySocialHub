-- 000037: Rollback — unschedule the pg_cron audit partition job.
-- Does NOT drop the pg_cron extension itself (other jobs may depend on it).

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        BEGIN
            PERFORM cron.unschedule('create_audit_partition');
            RAISE NOTICE 'pg_cron job ''create_audit_partition'' unscheduled.';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'pg_cron job ''create_audit_partition'' did not exist — nothing to unschedule.';
        END;
    END IF;
END $$;

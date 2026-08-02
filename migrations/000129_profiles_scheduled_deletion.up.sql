-- GDPR account-deletion scheduling (User.ScheduledDeletionAt → profiles).
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS scheduled_deletion_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_scheduled_deletion_at
    ON public.profiles (scheduled_deletion_at)
    WHERE scheduled_deletion_at IS NOT NULL;

COMMENT ON COLUMN public.profiles.scheduled_deletion_at IS
    'When set, deletion_worker purges the account after this timestamp.';

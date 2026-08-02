DROP INDEX IF EXISTS idx_profiles_scheduled_deletion_at;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS scheduled_deletion_at;

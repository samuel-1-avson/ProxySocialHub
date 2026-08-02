DROP INDEX IF EXISTS public.idx_profiles_email_hash;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS email_hash;
DROP TABLE IF EXISTS public.profile_private;

-- Restore NOT NULL only if no null emails remain (safe best-effort).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE email IS NULL) THEN
    ALTER TABLE public.profiles ALTER COLUMN email SET NOT NULL;
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'profiles.email NOT NULL restore skipped: %', SQLERRM;
END $$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role)
  VALUES (new.id, new.email, COALESCE(new.raw_user_meta_data->>'role', 'buyer'));
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Phase D: vault-shaped email + tax_id (PII). Keep profiles.email nullable stub for triggers.

CREATE TABLE IF NOT EXISTS public.profile_private (
    user_id     UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    email_enc   TEXT,
    tax_id_enc  TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.profile_private IS
    'Encrypted PII vault (email, tax_id). AES-GCM ciphertext with ENC: prefix via app ENCRYPTION_KEY.';

-- Lookup key: HMAC-SHA256 hex of lower(trim(email)) with EMAIL_HASH_PEPPER.
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS email_hash CHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_email_hash
    ON public.profiles (email_hash)
    WHERE email_hash IS NOT NULL AND email_hash <> '';

-- Allow nulling plaintext email after vault cutover (handle_new_user updated below).
ALTER TABLE public.profiles ALTER COLUMN email DROP NOT NULL;

-- Signup trigger: still stores email temporarily for bootstrap; app MIGRATE_EMAILS + signup
-- paths move to vault + email_hash. Prefer writing hash when pepper is unavailable in SQL.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role)
  VALUES (new.id, new.email, COALESCE(new.raw_user_meta_data->>'role', 'buyer'))
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON COLUMN public.profiles.email_hash IS
    'HMAC-SHA256 hex (EMAIL_HASH_PEPPER) of lower(trim(email)); preferred lookup key.';
COMMENT ON COLUMN public.profiles.email IS
    'Nullable plaintext stub during cutover; prefer profile_private.email_enc after MIGRATE_EMAILS.';

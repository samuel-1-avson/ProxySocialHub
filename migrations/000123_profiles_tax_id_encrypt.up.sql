-- P2 PII-01: widen tax_id for ENC: ciphertext storage.

ALTER TABLE public.profiles
    ALTER COLUMN tax_id TYPE TEXT;

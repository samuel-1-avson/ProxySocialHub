-- Narrowing TEXT → VARCHAR(50) may fail if ciphertext remains; truncate not attempted.
ALTER TABLE public.profiles
    ALTER COLUMN tax_id TYPE VARCHAR(50)
    USING LEFT(tax_id, 50);

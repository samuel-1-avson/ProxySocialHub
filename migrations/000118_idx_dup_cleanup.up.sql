-- P2 IDX-DUP: remove redundant uniqueness + dual country browse index.

-- linked_wallets: keep named unique index; drop duplicate table UNIQUE constraint.
CREATE UNIQUE INDEX IF NOT EXISTS idx_linked_wallet_unique
    ON public.linked_wallets (chain, address);

ALTER TABLE public.linked_wallets
    DROP CONSTRAINT IF EXISTS linked_wallets_chain_address_key;

-- Country browse: keep LOWER expression index; drop plain (status, country).
-- App TargetCountries path now uses LOWER(country) IN (...).
DROP INDEX IF EXISTS public.idx_proxy_listings_status_country;

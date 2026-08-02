-- Reverse IDX-DUP cleanup.

CREATE INDEX IF NOT EXISTS idx_proxy_listings_status_country
    ON public.proxy_listings (status, country);

ALTER TABLE public.linked_wallets
    ADD CONSTRAINT linked_wallets_chain_address_key UNIQUE (chain, address);

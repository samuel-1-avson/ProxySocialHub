-- Performance indexes for high-frequency queries
CREATE INDEX IF NOT EXISTS idx_sessions_status         ON public.sessions(status);
CREATE INDEX IF NOT EXISTS idx_orders_user_status      ON public.orders(user_id, status);
CREATE INDEX IF NOT EXISTS idx_listings_price_uptime   ON public.proxy_listings(price_per_gb, uptime_percentage);
CREATE INDEX IF NOT EXISTS idx_escrow_status           ON public.escrow_transactions(status);
CREATE INDEX IF NOT EXISTS idx_attestations_provider   ON public.quality_attestations(provider_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ledger_wallet_time      ON public.wallet_ledger_entries(wallet_id, created_at);

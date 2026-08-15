-- ============================================================
-- Migration 000141: session gateway cache (Sprint J0 / EV-05)
-- ============================================================
-- Durable dual-write of the Redis session:{username} JSON blob so
-- edge auth can hydrate after a Redis key miss/eviction.
-- Lookup key is sha256(hex) of the plaintext credentials username
-- (sessions.credentials_user is AES-encrypted and not queryable).
-- Does NOT make Redis HA; hot path remains Redis.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.session_gateway_cache (
    credentials_user_hash VARCHAR(64) PRIMARY KEY,
    session_id            UUID NOT NULL,
    payload               JSONB NOT NULL,
    expires_at            TIMESTAMPTZ NOT NULL,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_gateway_cache_session
    ON public.session_gateway_cache (session_id);

CREATE INDEX IF NOT EXISTS idx_session_gateway_cache_expires
    ON public.session_gateway_cache (expires_at);

COMMENT ON TABLE public.session_gateway_cache IS
    'Sprint J0: dual-write of edge session auth blob; hydrate on Redis miss.';

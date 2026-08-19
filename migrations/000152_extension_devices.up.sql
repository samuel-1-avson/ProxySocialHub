-- Browser extension pairing (PR-C). Device JWT is not the web refresh cookie.
CREATE TABLE IF NOT EXISTS public.extension_devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    extension_id VARCHAR(32) NOT NULL,
    name VARCHAR(100) NOT NULL DEFAULT '',
    refresh_token_hash VARCHAR(64),
    refresh_expires_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, extension_id)
);

CREATE INDEX IF NOT EXISTS idx_extension_devices_user_id
    ON public.extension_devices (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_extension_devices_refresh_hash
    ON public.extension_devices (refresh_token_hash)
    WHERE refresh_token_hash IS NOT NULL AND refresh_token_hash <> '';

COMMENT ON TABLE public.extension_devices IS
    'Paired MV3 extension devices. Access JWT kind=ext; refresh hash lives here, not in refresh_token_families.';

CREATE TABLE IF NOT EXISTS public.extension_pair_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code_hash VARCHAR(64) NOT NULL UNIQUE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_extension_pair_codes_user_id
    ON public.extension_pair_codes (user_id);

CREATE INDEX IF NOT EXISTS idx_extension_pair_codes_expires_at
    ON public.extension_pair_codes (expires_at);

COMMENT ON TABLE public.extension_pair_codes IS
    'One-time 60s pairing codes minted by the logged-in website for POST /v1/extension/pair/finish.';

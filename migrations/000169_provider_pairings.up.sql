-- Device pairing for provider nodes (modelled on RFC 8628, the OAuth device flow).
-- A node with no credentials asks for a short user code, its owner approves that code in
-- the logged-in dashboard, and the node then redeems the approval exactly once for a
-- provider token. This replaces downloading a setup script with the token written into it.
--
-- Nothing secret is stored: device_code_hash is the SHA-256 of a 256-bit secret only the
-- node holds, and the provider token is minted at redemption, so it never touches this table.
--
-- Uses only syntax available on Postgres 14 (the oldest major we deploy against).
CREATE TABLE IF NOT EXISTS public.provider_pairings (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_code_hash VARCHAR(64)  NOT NULL,
    user_code        VARCHAR(16)  NOT NULL,
    status           VARCHAR(16)  NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'approved', 'denied', 'redeemed')),
    device_name      VARCHAR(100) NOT NULL DEFAULT '',
    platform         VARCHAR(32)  NOT NULL DEFAULT '',
    arch             VARCHAR(32)  NOT NULL DEFAULT '',
    client_version   VARCHAR(32)  NOT NULL DEFAULT '',
    created_ip       VARCHAR(64)  NOT NULL DEFAULT '',
    -- The account that approved (or denied) the request.
    user_id          UUID,
    -- Filled in at redemption: the token and node that were created.
    token_id         UUID,
    node_id          UUID,
    next_poll_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    expires_at       TIMESTAMPTZ  NOT NULL,
    approved_at      TIMESTAMPTZ,
    redeemed_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    -- An approved or redeemed pairing always names who approved it, so redemption can
    -- never mint a token for nobody.
    CONSTRAINT provider_pairings_approver_chk
        CHECK (status IN ('pending', 'denied') OR user_id IS NOT NULL)
);

-- Lookups by the hashed secret (poll) and by the short code (lookup/approve).
CREATE UNIQUE INDEX IF NOT EXISTS ux_provider_pairings_device_code_hash
    ON public.provider_pairings (device_code_hash);
CREATE UNIQUE INDEX IF NOT EXISTS ux_provider_pairings_user_code
    ON public.provider_pairings (user_code);
-- Purging expired rows, and the per-address cap on new requests.
CREATE INDEX IF NOT EXISTS idx_provider_pairings_expires_at
    ON public.provider_pairings (expires_at);
CREATE INDEX IF NOT EXISTS idx_provider_pairings_created_ip_created_at
    ON public.provider_pairings (created_ip, created_at);

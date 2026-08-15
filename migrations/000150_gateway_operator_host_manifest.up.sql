-- Wave 6 — host identity + operator-signed manifest columns (ADR 0012)
ALTER TABLE public.gateway_operators
    ADD COLUMN IF NOT EXISTS host_id VARCHAR(128) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS manifest_payload TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS manifest_signature VARCHAR(128) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS manifest_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_gateway_operators_host_id
    ON public.gateway_operators (host_id)
    WHERE host_id <> '';

COMMENT ON COLUMN public.gateway_operators.host_id IS
    'Wave 6.A: operator host identity (distinct machine/org). Loopback twins are same_host.';
COMMENT ON COLUMN public.gateway_operators.manifest_signature IS
    'Wave 6.B: Ed25519 signature (base58) over canonical operator manifest bytes.';

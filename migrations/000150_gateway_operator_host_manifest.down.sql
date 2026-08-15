DROP INDEX IF EXISTS idx_gateway_operators_host_id;

ALTER TABLE public.gateway_operators
    DROP COLUMN IF EXISTS manifest_expires_at,
    DROP COLUMN IF EXISTS manifest_signature,
    DROP COLUMN IF EXISTS manifest_payload,
    DROP COLUMN IF EXISTS host_id;

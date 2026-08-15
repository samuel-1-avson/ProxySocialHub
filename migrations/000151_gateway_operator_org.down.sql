DROP INDEX IF EXISTS idx_gateway_operators_org_id;

ALTER TABLE public.gateway_operators
    DROP COLUMN IF EXISTS org_id;

-- Wave 7.D — operator org boundary (honesty). Empty org_id means platform org.
ALTER TABLE public.gateway_operators
    ADD COLUMN IF NOT EXISTS org_id VARCHAR(128) NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_gateway_operators_org_id
    ON public.gateway_operators (org_id)
    WHERE org_id <> '';

COMMENT ON COLUMN public.gateway_operators.org_id IS
    'Wave 7.D: operator organization id. Distinct from PROXYHUB_PLATFORM_ORG_ID => multi_org. Host-B in the same GCP project is still same_org.';

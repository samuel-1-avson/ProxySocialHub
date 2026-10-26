-- W-16 (P1): durable metering claims. Bytes claimed from Redis for
-- settlement are recorded here BEFORE the money transaction, in-flight
-- claims are requeued by a sweeper if the settler dies.
CREATE TABLE IF NOT EXISTS public.usage_metering_claims (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id   UUID NOT NULL,
    bytes        BIGINT NOT NULL CHECK (bytes > 0),
    sol_price_usd NUMERIC(20, 8),
    status       VARCHAR(24) NOT NULL DEFAULT 'claimed'
                 CHECK (status IN ('claimed', 'settled', 'consumed_external', 'requeued')),
    last_error   TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    settled_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_usage_metering_claims_session ON public.usage_metering_claims (session_id);
CREATE INDEX IF NOT EXISTS idx_usage_metering_claims_status_created ON public.usage_metering_claims (status, created_at);

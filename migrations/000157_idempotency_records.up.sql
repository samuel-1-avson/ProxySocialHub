-- P0-9 (W-11): client idempotency keys for money-moving user endpoints.
-- One row per (user, endpoint, key); created inside the money transaction so
-- a retry can never execute the transfer/withdrawal twice.

CREATE TABLE IF NOT EXISTS public.idempotency_records (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    endpoint        VARCHAR(64) NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    reference       VARCHAR(128) NOT NULL DEFAULT '',
    response_status INT NOT NULL DEFAULT 0,
    response_body   TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT idempotency_records_user_endpoint_key UNIQUE (user_id, endpoint, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_records_reference
    ON public.idempotency_records (reference)
    WHERE reference <> '';

COMMENT ON TABLE public.idempotency_records IS
    'P0-9: durable Idempotency-Key records for POST /wallet/transfer and /wallet/withdraw/sol. Empty response_body = in flight.';

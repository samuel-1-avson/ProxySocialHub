-- User withdrawal payout queue: process when hot is thin after vault→hot top-up.

CREATE TABLE IF NOT EXISTS public.withdrawal_payout_queue (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    wallet_id       UUID,
    reference       VARCHAR(128) NOT NULL,
    destination     VARCHAR(64) NOT NULL,
    amount_sol      NUMERIC(20, 9) NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'requested',
    attempts        INT NOT NULL DEFAULT 0,
    last_error      TEXT,
    tx_hash         VARCHAR(128),
    funded_at       TIMESTAMPTZ,
    paid_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT withdrawal_payout_queue_reference_key UNIQUE (reference)
);

CREATE INDEX IF NOT EXISTS idx_withdraw_payout_status_created
    ON public.withdrawal_payout_queue (status, created_at);

CREATE INDEX IF NOT EXISTS idx_withdraw_payout_user
    ON public.withdrawal_payout_queue (user_id, created_at DESC);

COMMENT ON TABLE public.withdrawal_payout_queue IS
    'Queued custodial SOL withdrawals awaiting hot-wallet liquidity (vault→hot then pay).';
COMMENT ON COLUMN public.withdrawal_payout_queue.status IS
    'requested | funding | paying | completed | failed | ops_required';

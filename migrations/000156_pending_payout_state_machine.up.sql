-- P0-1/P0-2 (W-01/W-02): pending_payouts becomes a durable state machine.
-- Rows are claimed by status transition, never deleted as a claiming mechanism.
-- States: queued -> claimed -> completed | failed (failed rows hand off to payout_retry_queue).

ALTER TABLE public.pending_payouts
    ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(64),
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'queued',
    ADD COLUMN IF NOT EXISTS batch_id UUID,
    ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

-- Backfill: every pre-existing row is waiting to be batched.
UPDATE public.pending_payouts
SET status = 'queued'
WHERE status IS NULL OR status = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_payouts_idempotency_key
    ON public.pending_payouts (idempotency_key)
    WHERE idempotency_key IS NOT NULL AND idempotency_key <> '';

CREATE INDEX IF NOT EXISTS idx_pending_payouts_claim
    ON public.pending_payouts (status, priority DESC, queued_at ASC);

COMMENT ON COLUMN public.pending_payouts.status IS
    'queued | claimed | completed | failed (P0 state machine; claimed rows carry batch_id + claimed_at)';
COMMENT ON COLUMN public.pending_payouts.idempotency_key IS
    'Per-payout unique key (payout UUID or hash of ledger reference); never a constant per provider (W-01)';

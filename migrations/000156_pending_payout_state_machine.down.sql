DROP INDEX IF EXISTS public.idx_pending_payouts_claim;
DROP INDEX IF EXISTS public.idx_pending_payouts_idempotency_key;

ALTER TABLE public.pending_payouts
    DROP COLUMN IF EXISTS claimed_at,
    DROP COLUMN IF EXISTS batch_id,
    DROP COLUMN IF EXISTS status,
    DROP COLUMN IF EXISTS idempotency_key;

-- Backfill: empty idempotency_key broke UNIQUE (only one '' row allowed globally).
UPDATE public.pending_transactions
SET idempotency_key = reference
WHERE idempotency_key IS NULL OR idempotency_key = '';

-- Drop full-column UNIQUE; partial index from 000044 handles non-empty keys only.
ALTER TABLE public.pending_transactions
    DROP CONSTRAINT IF EXISTS pending_transactions_idempotency_key_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_transactions_idempotency_key
    ON public.pending_transactions (idempotency_key)
    WHERE idempotency_key IS NOT NULL AND idempotency_key <> '';

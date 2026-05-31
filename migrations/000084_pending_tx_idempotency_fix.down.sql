DROP INDEX IF EXISTS idx_pending_transactions_idempotency_key;

ALTER TABLE public.pending_transactions
    ADD CONSTRAINT pending_transactions_idempotency_key_key UNIQUE (idempotency_key);

-- P0-15: Prevent duplicate transactions with the same idempotency key.
-- A non-unique index allows racing retries to insert duplicate rows; this
-- tightens it to a unique constraint so the second insert fails with a
-- constraint violation that the caller can handle as "already processed".
-- Only non-empty keys are constrained (NULL / empty string means no idempotency).
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_transactions_idempotency_key
    ON pending_transactions (idempotency_key)
    WHERE idempotency_key IS NOT NULL AND idempotency_key <> '';

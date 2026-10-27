-- Reverses 000168 (fails if a row holds a status longer than 20 characters).
ALTER TABLE usage_proofs ALTER COLUMN status TYPE VARCHAR(20);

ALTER TABLE pending_transactions DROP CONSTRAINT IF EXISTS fk_pending_tx_user;
DROP INDEX IF EXISTS idx_pending_tx_user_id;
ALTER TABLE pending_transactions ALTER COLUMN user_id TYPE varchar(100) USING user_id::text;

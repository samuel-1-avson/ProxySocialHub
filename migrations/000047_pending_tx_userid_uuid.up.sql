-- P2-16: Change pending_transactions.user_id from varchar(100) to uuid with FK.
-- First verify all existing values are valid UUIDs; rows that aren't will be
-- deleted (they are invalid orphan rows).
DELETE FROM pending_transactions
    WHERE user_id IS NULL
       OR user_id = ''
       OR user_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

ALTER TABLE pending_transactions
    ALTER COLUMN user_id TYPE uuid USING user_id::uuid;

ALTER TABLE pending_transactions
    ADD CONSTRAINT fk_pending_tx_user
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_pending_tx_user_id ON pending_transactions (user_id);

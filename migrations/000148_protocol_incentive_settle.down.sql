ALTER TABLE protocol_incentive_events

    DROP COLUMN IF EXISTS settled_at,

    DROP COLUMN IF EXISTS tx_hash,

    DROP COLUMN IF EXISTS recipient_wallet;



DROP INDEX IF EXISTS idx_protocol_incentive_status;


ALTER TABLE session_intents
    DROP COLUMN IF EXISTS archived_at,
    DROP COLUMN IF EXISTS chain_committed_at,
    DROP COLUMN IF EXISTS batched_at,
    DROP COLUMN IF EXISTS ledger_committed_at,
    DROP COLUMN IF EXISTS closing_at,
    DROP COLUMN IF EXISTS routed_at;
DROP INDEX IF EXISTS idx_session_intents_escrow_confirmed_at;
ALTER TABLE session_intents DROP COLUMN IF EXISTS escrow_confirmed_at;
ALTER TABLE sessions DROP COLUMN IF EXISTS escrow_confirmed_at;

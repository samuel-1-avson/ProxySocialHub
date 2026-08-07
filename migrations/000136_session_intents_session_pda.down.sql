DROP INDEX IF EXISTS idx_session_intents_session_pda;
ALTER TABLE session_intents
  DROP COLUMN IF EXISTS amount_locked_sol,
  DROP COLUMN IF EXISTS seller_wallet,
  DROP COLUMN IF EXISTS buyer_wallet,
  DROP COLUMN IF EXISTS payment_method,
  DROP COLUMN IF EXISTS session_pda;

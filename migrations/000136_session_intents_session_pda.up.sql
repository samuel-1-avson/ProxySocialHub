-- Phase 1c: prepaid SessionEscrow PDA fields on gateway session intents
ALTER TABLE session_intents
  ADD COLUMN IF NOT EXISTS session_pda VARCHAR(64),
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50),
  ADD COLUMN IF NOT EXISTS buyer_wallet VARCHAR(64),
  ADD COLUMN IF NOT EXISTS seller_wallet VARCHAR(64),
  ADD COLUMN IF NOT EXISTS amount_locked_sol NUMERIC(20, 9) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_session_intents_session_pda
  ON session_intents (session_pda)
  WHERE session_pda IS NOT NULL AND session_pda <> '';

COMMENT ON COLUMN session_intents.session_pda IS 'On-chain SessionEscrow PDA (seeds: session_escrow + intent UUID)';
COMMENT ON COLUMN session_intents.payment_method IS 'solana_session_escrow when prepaid; empty for custodial';

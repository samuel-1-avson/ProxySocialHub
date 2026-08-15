-- W1.1: SessionEscrow confirm timestamp — Active/CONNECT requires confirm, not fund/solana alone.
ALTER TABLE session_intents
  ADD COLUMN IF NOT EXISTS escrow_confirmed_at TIMESTAMPTZ;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS escrow_confirmed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_session_intents_escrow_confirmed_at
  ON session_intents (escrow_confirmed_at)
  WHERE escrow_confirmed_at IS NOT NULL;

-- Phase 1b: prepaid session escrow PDA columns on sessions.
ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS session_pda VARCHAR(64),
    ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50),
    ADD COLUMN IF NOT EXISTS buyer_wallet VARCHAR(64),
    ADD COLUMN IF NOT EXISTS seller_wallet VARCHAR(64),
    ADD COLUMN IF NOT EXISTS amount_locked_sol NUMERIC(20, 9) DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_sessions_session_pda
    ON sessions (session_pda)
    WHERE session_pda IS NOT NULL AND session_pda <> '';

COMMENT ON COLUMN sessions.session_pda IS
    'On-chain SessionEscrow PDA (seeds: session_escrow + session UUID)';
COMMENT ON COLUMN sessions.payment_method IS
    'Payment rail: solana_session_escrow for prepaid PAYG; empty for custodial';

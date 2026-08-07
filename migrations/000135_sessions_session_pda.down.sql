DROP INDEX IF EXISTS idx_sessions_session_pda;
ALTER TABLE sessions
    DROP COLUMN IF EXISTS session_pda,
    DROP COLUMN IF EXISTS payment_method,
    DROP COLUMN IF EXISTS buyer_wallet,
    DROP COLUMN IF EXISTS seller_wallet,
    DROP COLUMN IF EXISTS amount_locked_sol;

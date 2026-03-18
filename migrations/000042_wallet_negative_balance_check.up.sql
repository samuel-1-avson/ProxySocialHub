-- P1-07: Prevent negative wallet balances at the database level.
-- This acts as a last-resort guard even if application-layer checks are bypassed.
-- Wrapped in DO block because 000032 may have already added this constraint.
DO $$
BEGIN
    ALTER TABLE wallets
        ADD CONSTRAINT chk_wallet_balance_non_negative
        CHECK (balance_sol >= 0);
EXCEPTION WHEN duplicate_object THEN
    NULL; -- constraint already exists, that's fine
END $$;

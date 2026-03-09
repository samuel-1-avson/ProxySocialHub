-- Add SOL and USDT balance columns to wallets table
-- The existing 'balance' column maps to BalanceGHS in the Go model.
ALTER TABLE public.wallets
    ADD COLUMN IF NOT EXISTS balance_sol  NUMERIC(30, 9) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS balance_usdt NUMERIC(20, 4) NOT NULL DEFAULT 0;

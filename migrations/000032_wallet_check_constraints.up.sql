-- I2: Add CHECK constraints to prevent negative wallet balances and invalid spending limits.
-- These enforce financial integrity at the database layer — complementing application-level guards.

ALTER TABLE wallets
    ADD CONSTRAINT chk_wallet_balance_non_negative    CHECK (balance_sol >= 0),
    ADD CONSTRAINT chk_wallet_daily_limit_non_negative   CHECK (daily_limit >= 0),
    ADD CONSTRAINT chk_wallet_weekly_limit_non_negative  CHECK (weekly_limit >= 0),
    ADD CONSTRAINT chk_wallet_monthly_limit_non_negative CHECK (monthly_limit >= 0);

-- I2: Rollback — drop wallet CHECK constraints.

ALTER TABLE wallets
    DROP CONSTRAINT IF EXISTS chk_wallet_balance_non_negative,
    DROP CONSTRAINT IF EXISTS chk_wallet_daily_limit_non_negative,
    DROP CONSTRAINT IF EXISTS chk_wallet_weekly_limit_non_negative,
    DROP CONSTRAINT IF EXISTS chk_wallet_monthly_limit_non_negative;

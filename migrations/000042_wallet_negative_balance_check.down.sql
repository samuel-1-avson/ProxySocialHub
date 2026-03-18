ALTER TABLE wallets
    DROP CONSTRAINT IF EXISTS chk_wallet_balance_non_negative;

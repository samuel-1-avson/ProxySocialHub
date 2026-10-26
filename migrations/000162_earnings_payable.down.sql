ALTER TABLE public.wallets
    DROP COLUMN IF EXISTS auto_payout_threshold_lamports,
    DROP COLUMN IF EXISTS auto_payout_enabled,
    DROP COLUMN IF EXISTS earnings_payable_lamports;
-- ledger_accounts 2110 is left in place: historical journal lines may
-- reference it and the chart of accounts is append-only.

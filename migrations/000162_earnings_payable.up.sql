-- W-10 (P1): earnings payable sub-balance. Payable is the portion of
-- balance_lamports that is provider earnings available for payout;
-- payouts may only sweep payable, never buyer funds. Auto-payout is
-- opt-in (default OFF = manual claim).
ALTER TABLE public.wallets
    ADD COLUMN IF NOT EXISTS earnings_payable_lamports BIGINT NOT NULL DEFAULT 0
        CHECK (earnings_payable_lamports >= 0),
    ADD COLUMN IF NOT EXISTS auto_payout_enabled BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS auto_payout_threshold_lamports BIGINT NOT NULL DEFAULT 50000000
        CHECK (auto_payout_threshold_lamports >= 0);

-- Journal account for the payable sub-ledger (2100 spendable / 2110 payable).
INSERT INTO public.ledger_accounts (code, name, account_type)
VALUES ('2110', 'provider_earnings_payable', 'liability')
ON CONFLICT (code) DO NOTHING;

COMMENT ON COLUMN public.wallets.earnings_payable_lamports IS
'W-10: subset of balance_lamports that is provider earnings payable on-chain. Invariant: 0 <= payable <= balance_lamports.';

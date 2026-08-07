-- Phase 1 decentralization: deposit vault destination tracking + vault cash COA.

ALTER TABLE public.pending_transactions
    ADD COLUMN IF NOT EXISTS destination_kind VARCHAR(20);

UPDATE public.pending_transactions
SET destination_kind = 'treasury'
WHERE destination_kind IS NULL
  AND type IN ('crypto_deposit', 'deposit', 'deposit_auto');

INSERT INTO public.ledger_accounts (code, name, account_type) VALUES
    ('1001', 'deposit_vault_cash', 'asset')
ON CONFLICT (code) DO NOTHING;

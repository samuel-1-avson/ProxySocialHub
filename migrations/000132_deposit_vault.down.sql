UPDATE public.pending_transactions
SET destination_kind = NULL
WHERE destination_kind IN ('treasury', 'vault');

ALTER TABLE public.pending_transactions
    DROP COLUMN IF EXISTS destination_kind;

DELETE FROM public.ledger_accounts WHERE code = '1001';

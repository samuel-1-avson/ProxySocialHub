-- Reverse P0 ledger append-only + lamports columns.

DROP TRIGGER IF EXISTS trg_usage_receipt_fill_price_lamports ON public.usage_receipts;
DROP FUNCTION IF EXISTS public.usage_receipt_fill_price_lamports();
ALTER TABLE public.usage_receipts DROP COLUMN IF EXISTS billing_price_per_gb_lamports;

DROP TRIGGER IF EXISTS trg_wallet_ledger_archive_append_only ON public.wallet_ledger_entries_archive;
DROP TRIGGER IF EXISTS trg_wallet_ledger_append_only ON public.wallet_ledger_entries;
DROP FUNCTION IF EXISTS public.prevent_wallet_ledger_mutation();

DROP TRIGGER IF EXISTS trg_wallet_ledger_archive_fill_lamports ON public.wallet_ledger_entries_archive;
DROP TRIGGER IF EXISTS trg_wallet_ledger_fill_lamports ON public.wallet_ledger_entries;
DROP FUNCTION IF EXISTS public.wallet_ledger_fill_lamports();

ALTER TABLE public.wallet_ledger_entries_archive
    DROP COLUMN IF EXISTS amount_lamports,
    DROP COLUMN IF EXISTS balance_after_lamports;

ALTER TABLE public.wallet_ledger_entries
    DROP COLUMN IF EXISTS amount_lamports,
    DROP COLUMN IF EXISTS balance_after_lamports;

DROP TRIGGER IF EXISTS trg_wallets_sync_balance_lamports ON public.wallets;
DROP FUNCTION IF EXISTS public.sync_wallet_balance_lamports();
ALTER TABLE public.wallets DROP COLUMN IF EXISTS balance_lamports;

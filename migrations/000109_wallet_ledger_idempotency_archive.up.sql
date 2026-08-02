-- Ledger idempotency + cold archive for retention.
-- Prevents duplicate credits/debits when reference_id is set (payouts, rewards, escrow).

CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_ledger_wallet_type_ref
ON public.wallet_ledger_entries (wallet_id, type, reference_id)
WHERE reference_id IS NOT NULL AND reference_id <> '';

-- Archive table for aged ledger rows (copy-then-delete via retention job).
CREATE TABLE IF NOT EXISTS public.wallet_ledger_entries_archive (
    LIKE public.wallet_ledger_entries INCLUDING ALL
);

COMMENT ON TABLE public.wallet_ledger_entries_archive IS
'Cold copy of wallet_ledger_entries older than retention window. Hot table stays for reconciliation.';

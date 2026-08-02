-- P0 DB-02/DB-03: lamports dual-write columns + append-only ledger protection.
-- balance_sol / amount remain API-compatible; lamports are the precision source of truth going forward.

-- ── Wallets: integer lamports mirror ───────────────────────────────────────
ALTER TABLE public.wallets
    ADD COLUMN IF NOT EXISTS balance_lamports BIGINT NOT NULL DEFAULT 0;

UPDATE public.wallets
SET balance_lamports = ROUND(balance_sol * 1000000000)::bigint
WHERE balance_lamports = 0 AND balance_sol <> 0;

CREATE OR REPLACE FUNCTION public.sync_wallet_balance_lamports()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.balance_lamports := ROUND(COALESCE(NEW.balance_sol, 0) * 1000000000)::bigint;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wallets_sync_balance_lamports ON public.wallets;
CREATE TRIGGER trg_wallets_sync_balance_lamports
    BEFORE INSERT OR UPDATE OF balance_sol ON public.wallets
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_wallet_balance_lamports();

COMMENT ON COLUMN public.wallets.balance_lamports IS
'Integer lamports mirror of balance_sol (1 SOL = 1e9). Kept in sync by trigger; prefer this for reconciliation.';

-- ── Ledger: lamports columns ───────────────────────────────────────────────
ALTER TABLE public.wallet_ledger_entries
    ADD COLUMN IF NOT EXISTS amount_lamports BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS balance_after_lamports BIGINT NOT NULL DEFAULT 0;

UPDATE public.wallet_ledger_entries
SET
    amount_lamports = ROUND(amount * 1000000000)::bigint,
    balance_after_lamports = ROUND(balance_after * 1000000000)::bigint
WHERE amount_lamports = 0 AND balance_after_lamports = 0
  AND (amount <> 0 OR balance_after <> 0);

ALTER TABLE public.wallet_ledger_entries_archive
    ADD COLUMN IF NOT EXISTS amount_lamports BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS balance_after_lamports BIGINT NOT NULL DEFAULT 0;

UPDATE public.wallet_ledger_entries_archive
SET
    amount_lamports = ROUND(amount * 1000000000)::bigint,
    balance_after_lamports = ROUND(balance_after * 1000000000)::bigint
WHERE amount_lamports = 0 AND balance_after_lamports = 0
  AND (amount <> 0 OR balance_after <> 0);

CREATE OR REPLACE FUNCTION public.wallet_ledger_fill_lamports()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    -- Always derive from NUMERIC amount/balance_after when caller omitted lamports.
    IF NEW.amount_lamports IS NULL OR NEW.amount_lamports = 0 THEN
        NEW.amount_lamports := ROUND(COALESCE(NEW.amount, 0) * 1000000000)::bigint;
    END IF;
    IF NEW.balance_after_lamports IS NULL OR NEW.balance_after_lamports = 0 THEN
        NEW.balance_after_lamports := ROUND(COALESCE(NEW.balance_after, 0) * 1000000000)::bigint;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wallet_ledger_fill_lamports ON public.wallet_ledger_entries;
CREATE TRIGGER trg_wallet_ledger_fill_lamports
    BEFORE INSERT ON public.wallet_ledger_entries
    FOR EACH ROW
    EXECUTE FUNCTION public.wallet_ledger_fill_lamports();

DROP TRIGGER IF EXISTS trg_wallet_ledger_archive_fill_lamports ON public.wallet_ledger_entries_archive;
CREATE TRIGGER trg_wallet_ledger_archive_fill_lamports
    BEFORE INSERT ON public.wallet_ledger_entries_archive
    FOR EACH ROW
    EXECUTE FUNCTION public.wallet_ledger_fill_lamports();

-- ── Append-only enforcement (DB-03) ────────────────────────────────────────
-- Allow DELETE only when session GUC app.wallet_ledger_allow_mutate is:
--   'archive'     — retention job (wallet-ledger-archive.sh)
--   'gdpr_delete' — account deletion worker
-- UPDATE is never allowed.
CREATE OR REPLACE FUNCTION public.prevent_wallet_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    allow_mode text;
BEGIN
    allow_mode := COALESCE(current_setting('app.wallet_ledger_allow_mutate', true), '');

    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'wallet_ledger_entries is append-only: UPDATE denied'
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;

    IF TG_OP = 'DELETE' THEN
        IF allow_mode IN ('archive', 'gdpr_delete') THEN
            RETURN OLD;
        END IF;
        RAISE EXCEPTION 'wallet_ledger_entries is append-only: DELETE denied (set app.wallet_ledger_allow_mutate=archive|gdpr_delete)'
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_wallet_ledger_append_only ON public.wallet_ledger_entries;
CREATE TRIGGER trg_wallet_ledger_append_only
    BEFORE UPDATE OR DELETE ON public.wallet_ledger_entries
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_wallet_ledger_mutation();

DROP TRIGGER IF EXISTS trg_wallet_ledger_archive_append_only ON public.wallet_ledger_entries_archive;
CREATE TRIGGER trg_wallet_ledger_archive_append_only
    BEFORE UPDATE OR DELETE ON public.wallet_ledger_entries_archive
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_wallet_ledger_mutation();

COMMENT ON FUNCTION public.prevent_wallet_ledger_mutation() IS
'P0 append-only guard. DELETE allowed only with SET LOCAL app.wallet_ledger_allow_mutate TO archive|gdpr_delete.';

-- ── Usage receipts: lamports price mirror ──────────────────────────────────
ALTER TABLE public.usage_receipts
    ADD COLUMN IF NOT EXISTS billing_price_per_gb_lamports BIGINT NOT NULL DEFAULT 0;

UPDATE public.usage_receipts
SET billing_price_per_gb_lamports = ROUND(billing_price_per_gb * 1000000000)::bigint
WHERE billing_price_per_gb_lamports = 0 AND billing_price_per_gb <> 0;

CREATE OR REPLACE FUNCTION public.usage_receipt_fill_price_lamports()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.billing_price_per_gb_lamports IS NULL OR NEW.billing_price_per_gb_lamports = 0 THEN
        NEW.billing_price_per_gb_lamports := ROUND(COALESCE(NEW.billing_price_per_gb, 0) * 1000000000)::bigint;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_usage_receipt_fill_price_lamports ON public.usage_receipts;
CREATE TRIGGER trg_usage_receipt_fill_price_lamports
    BEFORE INSERT OR UPDATE OF billing_price_per_gb ON public.usage_receipts
    FOR EACH ROW
    EXECUTE FUNCTION public.usage_receipt_fill_price_lamports();

COMMENT ON COLUMN public.usage_receipts.billing_price_per_gb_lamports IS
'Integer lamports-per-GB mirror of billing_price_per_gb for settlement math.';

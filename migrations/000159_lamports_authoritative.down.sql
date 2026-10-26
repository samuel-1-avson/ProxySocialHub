-- Restore the 000116 float->lamports sync trigger/direction.
DROP TRIGGER IF EXISTS trg_wallets_sync_balance_sol ON public.wallets;
DROP FUNCTION IF EXISTS public.sync_wallet_balance_sol_from_lamports();

CREATE OR REPLACE FUNCTION public.sync_wallet_balance_lamports()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.balance_lamports := ROUND(COALESCE(NEW.balance_sol, 0) * 1000000000)::bigint;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_wallets_sync_balance_lamports
    BEFORE INSERT OR UPDATE OF balance_sol ON public.wallets
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_wallet_balance_lamports();

COMMENT ON COLUMN public.wallets.balance_lamports IS
'Integer lamports mirror of balance_sol (1 SOL = 1e9). Kept in sync by trigger; prefer this for reconciliation.';

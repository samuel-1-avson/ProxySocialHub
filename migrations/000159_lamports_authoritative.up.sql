-- W-19 (P1, incremental): balance_lamports becomes the single authoritative
-- stored balance. balance_sol remains as a derived display shadow.
-- 1) One-time repair of legacy rows whose lamports were never backfilled.
UPDATE public.wallets
SET balance_lamports = ROUND(balance_sol * 1000000000)::bigint
WHERE balance_lamports = 0 AND balance_sol > 0;

-- 2) Reverse the sync direction: derive the float shadow FROM lamports
--    (exact NUMERIC division) instead of deriving lamports from float.
DROP TRIGGER IF EXISTS trg_wallets_sync_balance_lamports ON public.wallets;
DROP FUNCTION IF EXISTS public.sync_wallet_balance_lamports();

CREATE OR REPLACE FUNCTION public.sync_wallet_balance_sol_from_lamports()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.balance_sol := COALESCE(NEW.balance_lamports, 0)::numeric / 1000000000;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_wallets_sync_balance_sol
    BEFORE INSERT OR UPDATE OF balance_lamports ON public.wallets
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_wallet_balance_sol_from_lamports();

COMMENT ON COLUMN public.wallets.balance_lamports IS
'W-19: authoritative integer balance (1 SOL = 1e9). balance_sol is a derived display shadow kept in sync by trg_wallets_sync_balance_sol.';

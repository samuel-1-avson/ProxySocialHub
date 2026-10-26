DROP INDEX IF EXISTS public.uq_ledger_journals_ref_type;
-- Note: '#dup-' namespacing of historical duplicate refs is not reversed
-- (the original duplicate values were ambiguous by construction).

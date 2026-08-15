-- 000124's FOR EACH STATEMENT balance trigger rejects journals when lines are
-- inserted across multiple INSERT statements (GORM Create-per-row). Replace it
-- with a deferred constraint trigger that runs at COMMIT, after all lines exist.

DROP TRIGGER IF EXISTS trg_journal_lines_balanced ON public.ledger_journal_lines;

CREATE OR REPLACE FUNCTION public.enforce_journal_balanced_deferred()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    bal BIGINT;
BEGIN
    SELECT COALESCE(SUM(amount_lamports), 0) INTO bal
    FROM public.ledger_journal_lines
    WHERE journal_id = NEW.journal_id;
    IF bal <> 0 THEN
        RAISE EXCEPTION 'ledger journal % is unbalanced (sum=%)', NEW.journal_id, bal
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_journal_lines_balanced_deferred ON public.ledger_journal_lines;
CREATE CONSTRAINT TRIGGER trg_journal_lines_balanced_deferred
    AFTER INSERT ON public.ledger_journal_lines
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_journal_balanced_deferred();

COMMENT ON FUNCTION public.enforce_journal_balanced_deferred() IS
    'DB-01: deferred journal balance check (fires at COMMIT; allows multi-statement line inserts).';

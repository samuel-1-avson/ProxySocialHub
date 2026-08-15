DROP TRIGGER IF EXISTS trg_journal_lines_balanced_deferred ON public.ledger_journal_lines;
DROP FUNCTION IF EXISTS public.enforce_journal_balanced_deferred();

-- Restore 000124 statement-level trigger.
DROP TRIGGER IF EXISTS trg_journal_lines_balanced ON public.ledger_journal_lines;
CREATE TRIGGER trg_journal_lines_balanced
    AFTER INSERT ON public.ledger_journal_lines
    REFERENCING NEW TABLE AS new_table
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.enforce_journal_balanced_stmt();

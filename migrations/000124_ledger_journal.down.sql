DROP TRIGGER IF EXISTS trg_journal_lines_append_only ON public.ledger_journal_lines;
DROP TRIGGER IF EXISTS trg_journal_lines_balanced ON public.ledger_journal_lines;
DROP FUNCTION IF EXISTS public.prevent_journal_line_mutation();
DROP FUNCTION IF EXISTS public.enforce_journal_balanced_stmt();
DROP FUNCTION IF EXISTS public.enforce_journal_balanced();
DROP TABLE IF EXISTS public.ledger_journal_lines;
DROP TABLE IF EXISTS public.ledger_journals;
DROP TABLE IF EXISTS public.ledger_accounts;

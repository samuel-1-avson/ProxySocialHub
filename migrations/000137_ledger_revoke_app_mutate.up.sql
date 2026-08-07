-- Phase 2 lite: revoke UPDATE/DELETE on append-only money tables from app role.
-- Archive/GDPR jobs continue via superuser or SET LOCAL proxyhub.allow_ledger_mutate.
-- Safe no-op when role 'proxyhubb' does not exist (local/dev).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proxyhubb') THEN
    REVOKE UPDATE, DELETE ON wallet_ledger_entries FROM proxyhubb;
    REVOKE UPDATE, DELETE ON wallet_ledger_entries_archive FROM proxyhubb;
    REVOKE UPDATE, DELETE ON ledger_journal_lines FROM proxyhubb;
    -- Headers stay mutable for rare ops annotations; lines are the immutable journal.
    GRANT SELECT, INSERT ON wallet_ledger_entries TO proxyhubb;
    GRANT SELECT, INSERT ON ledger_journal_lines TO proxyhubb;
    GRANT SELECT, INSERT ON ledger_journals TO proxyhubb;
  END IF;
END $$;

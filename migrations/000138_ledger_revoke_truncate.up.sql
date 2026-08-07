-- Phase 2 harden: also revoke TRUNCATE on append-only money tables.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proxyhubb') THEN
    REVOKE TRUNCATE ON wallet_ledger_entries FROM proxyhubb;
    REVOKE TRUNCATE ON wallet_ledger_entries_archive FROM proxyhubb;
    REVOKE TRUNCATE ON ledger_journal_lines FROM proxyhubb;
  END IF;
END $$;

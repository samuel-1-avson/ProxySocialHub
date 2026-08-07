-- Restore TRUNCATE for app role (dev rollback only).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proxyhubb') THEN
    GRANT TRUNCATE ON wallet_ledger_entries TO proxyhubb;
    GRANT TRUNCATE ON wallet_ledger_entries_archive TO proxyhubb;
    GRANT TRUNCATE ON ledger_journal_lines TO proxyhubb;
  END IF;
END $$;

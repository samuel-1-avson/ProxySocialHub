DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proxyhubb') THEN
    GRANT UPDATE, DELETE ON wallet_ledger_entries TO proxyhubb;
    GRANT UPDATE, DELETE ON wallet_ledger_entries_archive TO proxyhubb;
    GRANT UPDATE, DELETE ON ledger_journal_lines TO proxyhubb;
  END IF;
END $$;

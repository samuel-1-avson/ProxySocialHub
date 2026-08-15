#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
cat > /tmp/mig138.sql <<'SQL'
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proxyhubb') THEN
    REVOKE TRUNCATE ON wallet_ledger_entries FROM proxyhubb;
    REVOKE TRUNCATE ON wallet_ledger_entries_archive FROM proxyhubb;
    REVOKE TRUNCATE ON ledger_journal_lines FROM proxyhubb;
  END IF;
END $$;
SQL
cp /tmp/mig138.sql migrations/000138_ledger_revoke_truncate.up.sql
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -v ON_ERROR_STOP=1 -f - < /tmp/mig138.sql
echo MIG138_OK

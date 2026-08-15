#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo "=== flags ==="
"${COMPOSE[@]}" exec -T control-api sh -c 'printenv PROXYHUB_DEPOSIT_VAULT_UI PROXYHUB_DEPOSIT_LEGACY_TREASURY_CREDIT PROXYHUB_DEPOSIT_VAULT_CREDIT_ENABLED PROXYHUB_REQUIRE_SESSION_PDA APP_ENV USE_AWS_KMS' | tr -d '\r'

echo "=== addresses ==="
grep -E '^(SOLANA_TREASURY_ADDRESS|SOLANA_TREASURY_HOT_ADDRESS|SOLANA_DEPOSIT_VAULT)=' .env | tr -d '\r'

echo "=== grants ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
"SELECT table_name, privilege_type FROM information_schema.role_table_grants WHERE grantee = 'proxyhubb' AND table_name IN ('wallet_ledger_entries','ledger_journal_lines','ledger_journals') ORDER BY 1,2;"

T=$(grep -E '^SOLANA_TREASURY_ADDRESS=' .env | cut -d= -f2 | tr -d '\r')
H=$(grep -E '^SOLANA_TREASURY_HOT_ADDRESS=' .env | cut -d= -f2 | tr -d '\r')
echo "treasury=$T"
echo "hot=$H"
if [[ "$T" == "$H" ]]; then
  echo SKIP_SWEEP_treasury_eq_hot
else
  echo SWEEP_CANDIDATE
fi

echo VERIFY_DONE

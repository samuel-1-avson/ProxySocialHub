#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo "=== env flags ==="
sudo grep -E '^(PROXYHUB_DEPOSIT_VAULT|PROXYHUB_DEPOSIT_LEGACY|PROXYHUB_REQUIRE_SESSION|SOLANA_DEPOSIT_VAULT|SOLANA_TREASURY_ADDRESS|SOLANA_TREASURY_HOT)=' .env || true

echo "=== container flags ==="
"${COMPOSE[@]}" exec -T control-api sh -c 'printenv | grep -E "PROXYHUB_DEPOSIT|PROXYHUB_REQUIRE_SESSION|APP_ENV|USE_AWS" | sort' || true

echo "=== session_intents columns ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c "\d session_intents" 2>/dev/null | grep -E 'session_pda|payment_method|buyer_wallet|seller_wallet|amount_locked' || echo NO_INTENT_PDA_COLS

echo "=== ledger grants ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c "
SELECT table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'proxyhubb'
  AND table_name IN ('wallet_ledger_entries','ledger_journal_lines','ledger_journals')
ORDER BY 1,2;" || true

echo "=== program upgrade authority (local solana if present) ==="
if command -v solana >/dev/null 2>&1; then
  RPC=$(sudo grep -E '^SOLANA_RPC_ENDPOINT=' .env | head -1 | cut -d= -f2- | tr -d '\r' || true)
  RPC="${RPC:-https://api.devnet.solana.com}"
  solana program show AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu --url "$RPC" 2>/dev/null | head -20 || true
fi
echo INSPECT_DONE

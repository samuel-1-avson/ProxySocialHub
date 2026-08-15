#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo "== linked users =="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -At -F '|' <<'SQL'
SELECT u.id::text || '|' || COALESCE(u.wallet_address,'') || '|' || COALESCE(w.balance_sol::text,'0')
FROM users u
LEFT JOIN wallets w ON w.user_id = u.id
WHERE u.wallet_address IS NOT NULL AND length(u.wallet_address) > 20
ORDER BY w.balance_sol DESC NULLS LAST
LIMIT 8;
SQL

echo "== linked_wallets =="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -At -F '|' <<'SQL'
SELECT address || '|' || user_id::text FROM linked_wallets LIMIT 8;
SQL

echo "== recent vault/crypto deposits =="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -At -F '|' <<'SQL'
SELECT COALESCE(destination_kind,'') || '|' || status || '|' || amount::text || '|' || LEFT(COALESCE(reference,''),16)
FROM pending_transactions
WHERE type = 'crypto_deposit'
ORDER BY created_at DESC NULLS LAST
LIMIT 5;
SQL

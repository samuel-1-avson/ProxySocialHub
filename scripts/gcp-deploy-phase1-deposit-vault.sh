#!/usr/bin/env bash
set -euo pipefail
PROJECT_DIR=/opt/proxyhubb
DEPLOY_TAR="${DEPLOY_TAR:?}"
DOCKER=docker
cd "$PROJECT_DIR"
tmpdir=$(mktemp -d)
tar -xzf "$DEPLOY_TAR" -C "$tmpdir"
cp -a "$tmpdir/control-api/." "$PROJECT_DIR/services/control-api/"
if [ -d "$tmpdir/migrations" ]; then
  cp -a "$tmpdir/migrations/." "$PROJECT_DIR/migrations/"
fi
rm -rf "$tmpdir"
find "$PROJECT_DIR/services/control-api" -name '*.go' -exec sed -i 's/\r$//' {} +
find "$PROJECT_DIR/migrations" -name '*.sql' -exec sed -i 's/\r$//' {} +
test -f "$PROJECT_DIR/services/control-api/internal/solana/deposit_vault.go"
test -f "$PROJECT_DIR/migrations/000132_deposit_vault.up.sql"
grep -q 'DepositVaultCreditEnabled' "$PROJECT_DIR/services/control-api/internal/decentralization/mode.go"
COMPOSE=($DOCKER compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
"${COMPOSE[@]}" build control-api
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api
for i in $(seq 1 48); do
  st=$("${COMPOSE[@]}" ps control-api --format '{{.Status}}' || true)
  echo "try=$i $st"
  echo "$st" | grep -qi healthy && break
  sleep 5
done
echo "$st" | grep -qi healthy
# Apply migration 000132 if migrate container/tooling exists; else SQL via postgres
if "${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c "\d pending_transactions" >/dev/null 2>&1; then
  "${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb < "$PROJECT_DIR/migrations/000132_deposit_vault.up.sql" || true
fi
sleep 2
sudo docker logs proxyhubb-control-api-1 2>&1 | grep -E 'Deposit vault|BC-08|rpc_endpoints|Oracle initialized' | tail -n 20 || true
curl -sS http://127.0.0.1:18080/v1/system/config/public | head -c 800; echo
echo DONE

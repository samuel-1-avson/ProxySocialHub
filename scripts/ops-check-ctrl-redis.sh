#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo "=== control-api health ==="
docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' proxyhubb-control-api-1
curl -sS -m 5 http://127.0.0.1:18080/healthz || curl -sS -m 5 http://127.0.0.1:18080/health || true
echo
"${COMPOSE[@]}" logs control-api --tail 40 2>&1 | tail -40

echo "=== activation events recent ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT created_at, status, reason, left(coalesce(last_error,''),120) AS err FROM escrow_reconciliation_events WHERE event_type ILIKE '%activation%' OR source ILIKE '%activation%' ORDER BY created_at DESC LIMIT 10;" 2>/dev/null || \
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT column_name FROM information_schema.columns WHERE table_name='escrow_reconciliation_events';"

echo "=== order 40667665 ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT id, status, session_id, escrow_pda FROM orders WHERE id='40667665-0867-4c4c-b228-61c1a3e2ea02';"

echo "=== redis auth + keys ==="
RP=$("${COMPOSE[@]}" exec -T control-api printenv REDIS_PASSWORD | tr -d '\r')
"${COMPOSE[@]}" exec -T redis redis-cli -a "$RP" --no-auth-warning KEYS 'session:*' | head -30
"${COMPOSE[@]}" exec -T redis redis-cli -a "$RP" --no-auth-warning DBSIZE

echo "=== provider tunnel ==="
docker logs proxyhubb-provider-node --tail 5 2>&1 | grep -iE 'tunnel|error|auth' || true

echo CTRL_REDIS_CHECK_DONE

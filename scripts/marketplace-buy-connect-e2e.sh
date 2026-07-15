#!/usr/bin/env bash
# Full marketplace path: create order → dev escrow activate → fetch credentials → CONNECT via edge.
# Requires docker stack with control-api, redis, edge-gateway, provider-node (run provider-docker-e2e.sh first
# or set MARKETPLACE_E2E_SKIP_STACK=1 when stack is already healthy).
#
# Usage (repo root):
#   ./scripts/marketplace-buy-connect-e2e.sh
#   MARKETPLACE_E2E_SKIP_STACK=1 ./scripts/marketplace-buy-connect-e2e.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

API_BASE="${CONTROL_API_PUBLIC_URL:-http://127.0.0.1:18080}"
# Host-published buyer port (docker-compose maps edge :8090 → host EDGE_GATEWAY_PORT, often 18090 in .env).
BUYER_PORT="${EDGE_GATEWAY_PORT:-8090}"
PG_USER="${POSTGRES_USER:-proxyhubb}"
PG_DB="${POSTGRES_DB:-proxyhubb}"
PG_PASS="${POSTGRES_PASSWORD:-admin}"

if [[ "${MARKETPLACE_E2E_SKIP_STACK:-}" != "1" ]]; then
  echo "Bootstrapping provider + edge stack..."
  ./scripts/provider-docker-e2e.sh
  # provider-docker-e2e ends after tunnel check; continue with marketplace flow below.
  MARKETPLACE_E2E_SKIP_STACK=1
fi

echo "=== Resolving active listing ==="
LISTING_ID="$(docker exec -e PGPASSWORD="$PG_PASS" proxyhubb-postgres-1 \
  psql -U "$PG_USER" -d "$PG_DB" -tAc \
  "SELECT id::text FROM proxy_listings WHERE status = 'active' ORDER BY created_at DESC LIMIT 1;" | tr -d '[:space:]')"

if [[ -z "$LISTING_ID" ]]; then
  if command -v pwsh >/dev/null 2>&1; then
    echo "No active listing — creating signed listing via post-signed-listing-docker.ps1"
    pwsh -File ./scripts/post-signed-listing-docker.ps1 -ApiBaseUrl "$API_BASE"
    LISTING_ID="$(docker exec -e PGPASSWORD="$PG_PASS" proxyhubb-postgres-1 \
      psql -U "$PG_USER" -d "$PG_DB" -tAc \
      "SELECT id::text FROM proxy_listings WHERE status = 'active' ORDER BY created_at DESC LIMIT 1;" | tr -d '[:space:]')"
  fi
fi

if [[ -z "$LISTING_ID" ]]; then
  echo "No active listing found. Run post-signed-listing-docker.ps1 or create a listing first." >&2
  exit 1
fi
echo "Listing: $LISTING_ID"

PG_HOST_PORT="${POSTGRES_HOST_PORT:-55432}"
export DATABASE_URL="postgresql://${PG_USER}:${PG_PASS}@127.0.0.1:${PG_HOST_PORT}/${PG_DB}?sslmode=disable"

echo "=== Minting buyer JWT ==="
BUYER_JSON="$(cd services/control-api && go run ./cmd/buyer_dev_token \
  -ensure-buyer \
  -wallet 8g7WUuPosAg82Uu7iGYCx6HBnoTBFb4QuyiJCEGzktU4 \
  -json)"
BUYER_TOKEN="$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['token'])" "$BUYER_JSON")"
BUYER_ID="$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['user_id'])" "$BUYER_JSON")"

docker exec -e PGPASSWORD="$PG_PASS" proxyhubb-postgres-1 \
  psql -U "$PG_USER" -d "$PG_DB" -c \
  "UPDATE wallets SET balance_sol = 100 WHERE user_id = '$BUYER_ID'::uuid;" >/dev/null

echo "=== Creating marketplace order ==="
ORDER_RESP="$(curl -sf -X POST "$API_BASE/v1/orders" \
  -H "Authorization: Bearer $BUYER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"listing_id\":\"$LISTING_ID\",\"bandwidth_gb\":1}")"
ORDER_ID="$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d.get('order', d).get('id',''))" "$ORDER_RESP")"
if [[ -z "$ORDER_ID" ]]; then
  echo "Failed to create order: $ORDER_RESP" >&2
  exit 1
fi
echo "Order: $ORDER_ID"

echo "=== Dev escrow activate (simulates on-chain confirmation) ==="
ACTIVATE_RESP="$(curl -sf -X POST "$API_BASE/v1/orders/$ORDER_ID/activate-dev" \
  -H "Authorization: Bearer $BUYER_TOKEN")"

CRED_USER="$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['proxy_credentials']['username'])" "$ACTIVATE_RESP")"
CRED_PASS="$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['proxy_credentials']['password'])" "$ACTIVATE_RESP")"
NODE_ID="$(docker exec -e PGPASSWORD="$PG_PASS" proxyhubb-postgres-1 \
  psql -U "$PG_USER" -d "$PG_DB" -tAc \
  "SELECT COALESCE(gateway_node_id, 'node_' || user_id::text) FROM provider_nodes ORDER BY last_seen_at DESC NULLS LAST, created_at DESC LIMIT 1;" | tr -d '[:space:]')"

echo "Pinned node (registry): $NODE_ID"
echo "Credentials user: $CRED_USER"

echo "=== Buyer CONNECT through edge :$BUYER_PORT ==="
if curl -sf --max-time 60 -x "http://${CRED_USER}:${CRED_PASS}@127.0.0.1:${BUYER_PORT}" https://example.com -o /dev/null; then
  echo "Marketplace buy → activate → CONNECT E2E passed."
else
  echo "CONNECT failed after marketplace order activation." >&2
  exit 1
fi

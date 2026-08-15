#!/usr/bin/env bash
# Deploy Sprint B money-path hardening to GCP testnet.
set -euo pipefail
TAR="${1:?usage: $0 /tmp/sprint-b-money.tar.gz}"
PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
DOCKER="${DOCKER:-docker}"
cd "$PROJECT_DIR"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Extract $TAR into $PROJECT_DIR"
tar -xzf "$TAR" -C "$PROJECT_DIR"

find "$PROJECT_DIR/services/control-api/internal" "$PROJECT_DIR/migrations" "$PROJECT_DIR/scripts" \
  -type f \( -name '*.go' -o -name '*.sql' -o -name '*.sh' -o -name '*.yml' \) \
  -exec sed -i 's/\r$//' {} + 2>/dev/null || true
chmod +x "$PROJECT_DIR/scripts/"*.sh 2>/dev/null || true

ENV_FILE="$PROJECT_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  if grep -q '^PROXYHUB_DEPOSIT_REQUIRE_FINALIZED=' "$ENV_FILE"; then
    sed -i 's/^PROXYHUB_DEPOSIT_REQUIRE_FINALIZED=.*/PROXYHUB_DEPOSIT_REQUIRE_FINALIZED=true/' "$ENV_FILE"
  else
    echo 'PROXYHUB_DEPOSIT_REQUIRE_FINALIZED=true' >> "$ENV_FILE"
  fi
  echo "set PROXYHUB_DEPOSIT_REQUIRE_FINALIZED=true in .env"
fi

COMPOSE=("$DOCKER" compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo "Building db-migrate + control-api..."
"${COMPOSE[@]}" build db-migrate control-api

echo "Running db-migrate..."
"${COMPOSE[@]}" run --rm --no-deps db-migrate

echo "Recreating control-api..."
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api

ok=0
for i in $(seq 1 72); do
  st=$("${COMPOSE[@]}" ps control-api --format '{{.Status}}' 2>/dev/null || true)
  echo "try=$i control-api $st"
  if echo "$st" | grep -qi healthy; then
    echo "control-api HEALTHY"
    ok=1
    break
  fi
  sleep 5
done
[[ "$ok" == "1" ]] || { echo "control-api unhealthy"; "${COMPOSE[@]}" logs --tail=80 control-api; exit 1; }

echo "=== schema 000116 ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT version FROM schema_migrations WHERE version LIKE '%000116%';"
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT column_name FROM information_schema.columns WHERE table_name='wallets' AND column_name='balance_lamports';"

echo "=== flags ==="
"${COMPOSE[@]}" exec -T control-api sh -c \
  'printf "ESCROW=%s SESSION=%s FINALIZED=%s LEGACY=%s VAULT_UI=%s\n" \
    "$PROXYHUB_REQUIRE_ESCROW_PDA" "$PROXYHUB_REQUIRE_SESSION_PDA" \
    "$PROXYHUB_DEPOSIT_REQUIRE_FINALIZED" "$PROXYHUB_DEPOSIT_LEGACY_TREASURY_CREDIT" \
    "$PROXYHUB_DEPOSIT_VAULT_UI"'

echo "DONE sprint-b deploy"

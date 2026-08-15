#!/usr/bin/env bash
# Deploy Sprint C (trust + finance) to GCP testnet.
set -euo pipefail
TAR="${1:?usage: $0 /tmp/sprint-c.tar.gz}"
PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
DOCKER="${DOCKER:-docker}"
cd "$PROJECT_DIR"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Extract $TAR"
tar -xzf "$TAR" -C "$PROJECT_DIR"
find "$PROJECT_DIR/services/control-api" "$PROJECT_DIR/migrations" "$PROJECT_DIR/apps/web" "$PROJECT_DIR/scripts" \
  -type f \( -name '*.go' -o -name '*.sql' -o -name '*.ts' -o -name '*.tsx' -o -name '*.sh' -o -name '*.md' \) \
  -exec sed -i 's/\r$//' {} + 2>/dev/null || true
chmod +x "$PROJECT_DIR/scripts/"*.sh 2>/dev/null || true

COMPOSE=("$DOCKER" compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo "Building db-migrate + control-api + web..."
"${COMPOSE[@]}" build db-migrate control-api web

echo "Running db-migrate..."
chmod -R a+rX "$PROJECT_DIR/migrations" || true
"${COMPOSE[@]}" run --rm --no-deps db-migrate

echo "Recreating control-api + web..."
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api web

for svc in control-api web; do
  ok=0
  for i in $(seq 1 72); do
    st=$("${COMPOSE[@]}" ps "$svc" --format '{{.Status}}' 2>/dev/null || true)
    echo "try=$i $svc $st"
    if echo "$st" | grep -qi healthy; then
      echo "$svc HEALTHY"
      ok=1
      break
    fi
    sleep 5
  done
  [[ "$ok" == "1" ]] || { echo "$svc unhealthy"; "${COMPOSE[@]}" logs --tail=60 "$svc"; exit 1; }
done

echo "=== migration 000139 ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT version FROM schema_migrations WHERE version LIKE '%000139%';"
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT column_name FROM information_schema.columns WHERE table_name='compensation_outbox' AND column_name='metadata';"

echo "=== SESSION_PROGRAM_ID must be unset ==="
sid=$("${COMPOSE[@]}" exec -T control-api printenv SESSION_PROGRAM_ID 2>/dev/null | tr -d '\r' || true)
if [[ -n "${sid:-}" ]]; then
  echo "FAIL: SESSION_PROGRAM_ID is set: $sid"
  exit 1
fi
echo "SESSION_PROGRAM_UNSET_OK"

echo "DONE sprint-c deploy"

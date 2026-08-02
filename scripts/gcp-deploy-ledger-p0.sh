#!/usr/bin/env bash
# Emergency deploy: P0 ledger append-only + lamports (000116) + migrate hard-fail.
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
DEPLOY_TAR="${DEPLOY_TAR:?Set DEPLOY_TAR}"
DOCKER="${DOCKER:-docker}"

cd "$PROJECT_DIR"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Extracting $DEPLOY_TAR"
tmpdir=$(mktemp -d)
tar -xzf "$DEPLOY_TAR" -C "$tmpdir"

if [[ -d "$tmpdir/migrations" ]]; then
  mkdir -p "$PROJECT_DIR/migrations"
  cp -a "$tmpdir/migrations/." "$PROJECT_DIR/migrations/"
fi
if [[ -d "$tmpdir/control-api" ]]; then
  mkdir -p "$PROJECT_DIR/services/control-api"
  cp -a "$tmpdir/control-api/." "$PROJECT_DIR/services/control-api/"
fi
if [[ -d "$tmpdir/scripts" ]]; then
  mkdir -p "$PROJECT_DIR/scripts"
  cp -a "$tmpdir/scripts/." "$PROJECT_DIR/scripts/"
fi
rm -rf "$tmpdir"

# Strip CRLF from synced sources
find "$PROJECT_DIR/services/control-api/internal" "$PROJECT_DIR/migrations" "$PROJECT_DIR/scripts" \
  -type f \( -name '*.go' -o -name '*.sql' -o -name '*.sh' \) \
  -exec sed -i 's/\r$//' {} + 2>/dev/null || true

test -f "$PROJECT_DIR/migrations/000116_ledger_append_only_lamports.up.sql" \
  || { echo "missing 000116 up" >&2; exit 1; }
grep -q 'prevent_wallet_ledger_mutation' \
  "$PROJECT_DIR/migrations/000116_ledger_append_only_lamports.up.sql" \
  || { echo "000116 missing append-only trigger" >&2; exit 1; }
grep -q 'hard-fail' "$PROJECT_DIR/services/control-api/internal/db/migrate.go" \
  || { echo "migrate.go missing hard-fail comment" >&2; exit 1; }
grep -q 'BalanceLamports' "$PROJECT_DIR/services/control-api/internal/models/wallet.go" \
  || { echo "wallet.go missing BalanceLamports" >&2; exit 1; }
grep -q 'wallet_ledger_allow_mutate' \
  "$PROJECT_DIR/services/control-api/internal/worker/deletion_worker.go" \
  || { echo "deletion_worker missing mutate GUC" >&2; exit 1; }
grep -q 'wallet_ledger_allow_mutate' "$PROJECT_DIR/scripts/wallet-ledger-archive.sh" \
  || { echo "archive script missing mutate GUC" >&2; exit 1; }

COMPOSE=(
  "$DOCKER" compose
  -f "$PROJECT_DIR/docker-compose.yml"
  -f "$PROJECT_DIR/docker-compose.testnet.yml"
  -f "$PROJECT_DIR/docker-compose.gcp-testnet.yml"
)

cd "$PROJECT_DIR"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Building db-migrate + control-api (emergency, no GHCR overlay)"
"${COMPOSE[@]}" build db-migrate control-api

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Running db-migrate (apply 000116)"
"${COMPOSE[@]}" run --rm --no-deps db-migrate

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Recreating control-api"
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Waiting for healthy…"
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
if [[ "$ok" != "1" ]]; then
  echo "control-api failed to become healthy" >&2
  "${COMPOSE[@]}" logs --tail=100 control-api || true
  exit 1
fi

echo "=== verify schema ==="
"${COMPOSE[@]}" exec -T postgres psql -U "${POSTGRES_USER:-proxyhubb}" -d "${POSTGRES_DB:-proxyhubb}" -v ON_ERROR_STOP=1 <<'SQL'
SELECT version FROM schema_migrations WHERE version = '000116_ledger_append_only_lamports';
SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='wallets' AND column_name='balance_lamports';
SELECT tgname FROM pg_trigger
  WHERE tgrelid = 'public.wallet_ledger_entries'::regclass
    AND tgname LIKE '%append_only%';
SQL

echo "=== verify API ==="
curl -sS -o /dev/null -w "api_health=%{http_code}\n" http://127.0.0.1:8080/health || true
API_HAS=$(sudo docker exec proxyhubb-control-api-1 sh -c \
  'strings /server 2>/dev/null | grep -c BalanceLamports || true')
echo "API_HAS_BalanceLamports=${API_HAS:-0}"

echo "LEDGER_P0_DEPLOY_DONE"

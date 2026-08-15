#!/usr/bin/env bash
# Emergency fix: journal balance trigger blocks deposits/withdrawals.
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

find "$PROJECT_DIR/services/control-api" "$PROJECT_DIR/migrations" "$PROJECT_DIR/scripts" \
  -type f \( -name '*.go' -o -name '*.sql' -o -name '*.sh' \) \
  -exec sed -i 's/\r$//' {} + 2>/dev/null || true
chmod +x "$PROJECT_DIR/scripts/"*.sh 2>/dev/null || true

test -f "$PROJECT_DIR/migrations/000131_journal_balance_deferred.up.sql"
grep -q 'multi-row INSERT' "$PROJECT_DIR/services/control-api/internal/models/ledger_journal.go" \
  || grep -q 'One statement so the statement-level' "$PROJECT_DIR/services/control-api/internal/models/ledger_journal.go"
grep -q 'Create(&rows)' "$PROJECT_DIR/services/control-api/internal/models/ledger_journal.go"
echo JOURNAL_FIX_SOURCES_OK

COMPOSE=(
  "$DOCKER" compose
  -f "$PROJECT_DIR/docker-compose.yml"
  -f "$PROJECT_DIR/docker-compose.testnet.yml"
  -f "$PROJECT_DIR/docker-compose.gcp-testnet.yml"
)

cd "$PROJECT_DIR"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Building db-migrate + control-api"
"${COMPOSE[@]}" build db-migrate control-api

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Running db-migrate (000131)"
"${COMPOSE[@]}" run --rm --no-deps db-migrate

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Recreating control-api"
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
if [[ "$ok" != "1" ]]; then
  echo "control-api failed healthy" >&2
  "${COMPOSE[@]}" logs --tail=100 control-api || true
  exit 1
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Verify deferred trigger"
sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -c \
  "SELECT tgname FROM pg_trigger WHERE tgrelid='public.ledger_journal_lines'::regclass AND NOT tgisinternal ORDER BY tgname;"

echo JOURNAL_FIX_DONE


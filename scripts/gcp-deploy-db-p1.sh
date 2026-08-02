#!/usr/bin/env bash
# Emergency deploy: P1 explorer partitions (000117) + lamports recon + archive cron scripts.
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
if [[ -d "$tmpdir/infra" ]]; then
  mkdir -p "$PROJECT_DIR/infra"
  cp -a "$tmpdir/infra/." "$PROJECT_DIR/infra/"
fi
rm -rf "$tmpdir"

find "$PROJECT_DIR/services/control-api/internal" "$PROJECT_DIR/migrations" "$PROJECT_DIR/scripts" \
  -type f \( -name '*.go' -o -name '*.sql' -o -name '*.sh' \) \
  -exec sed -i 's/\r$//' {} + 2>/dev/null || true

test -f "$PROJECT_DIR/migrations/000117_explorer_partition_maintenance.up.sql" \
  || { echo "missing 000117 up" >&2; exit 1; }
grep -q 'create_explorer_partition_if_not_exists' \
  "$PROJECT_DIR/migrations/000117_explorer_partition_maintenance.up.sql" \
  || { echo "000117 missing helper" >&2; exit 1; }
grep -q 'balance_lamports' \
  "$PROJECT_DIR/services/control-api/internal/treasury/reconciliation.go" \
  || { echo "reconciliation missing lamports check" >&2; exit 1; }
grep -q 'pgbouncer-userlist' "$PROJECT_DIR/infra/k8s/pgbouncer.yaml" \
  || { echo "pgbouncer.yaml missing secret mount" >&2; exit 1; }
! grep -q 'md5_PGBOUNCER_.*_UNSET' "$PROJECT_DIR/infra/k8s/pgbouncer.yaml" \
  || { echo "pgbouncer.yaml still has UNSET MD5 placeholders" >&2; exit 1; }

chmod +x "$PROJECT_DIR/scripts/wallet-ledger-archive.sh" \
  "$PROJECT_DIR/scripts/gcp-wallet-ledger-archive-install.sh" \
  "$PROJECT_DIR/scripts/gcp-wallet-ledger-archive-verify.sh" 2>/dev/null || true

COMPOSE=(
  "$DOCKER" compose
  -f "$PROJECT_DIR/docker-compose.yml"
  -f "$PROJECT_DIR/docker-compose.testnet.yml"
  -f "$PROJECT_DIR/docker-compose.gcp-testnet.yml"
)

cd "$PROJECT_DIR"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Building db-migrate + control-api"
"${COMPOSE[@]}" build db-migrate control-api

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Running db-migrate (apply 000117)"
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
  echo "control-api failed to become healthy" >&2
  "${COMPOSE[@]}" logs --tail=100 control-api || true
  exit 1
fi

echo "=== install archive cron ==="
sudo PROJECT_DIR="$PROJECT_DIR" DOCKER="$DOCKER" \
  bash "$PROJECT_DIR/scripts/gcp-wallet-ledger-archive-install.sh"
sudo PROJECT_DIR="$PROJECT_DIR" DOCKER="$DOCKER" \
  bash "$PROJECT_DIR/scripts/gcp-wallet-ledger-archive-verify.sh"

echo "=== verify schema / partitions ==="
"${COMPOSE[@]}" exec -T postgres psql -U "${POSTGRES_USER:-proxyhubb}" -d "${POSTGRES_DB:-proxyhubb}" -v ON_ERROR_STOP=1 <<'SQL'
SELECT version FROM schema_migrations WHERE version = '000117_explorer_partition_maintenance';
SELECT c.relname AS partition
FROM pg_inherits i
JOIN pg_class c ON c.oid = i.inhrelid
JOIN pg_class p ON p.oid = i.inhparent
WHERE p.relname = 'explorer_transactions'
ORDER BY 1;
SQL

curl -sS -o /dev/null -w "api_health=%{http_code}\n" http://127.0.0.1:8080/health || true
echo "DB_P1_DEPLOY_DONE"

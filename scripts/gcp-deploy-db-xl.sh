#!/usr/bin/env bash
# Emergency deploy: DB-01 journal + PII vault + P3 indexes/TTL (000124–000127) + control-api.
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

find "$PROJECT_DIR/services/control-api" "$PROJECT_DIR/migrations" "$PROJECT_DIR/scripts" \
  -type f \( -name '*.go' -o -name '*.sql' -o -name '*.sh' -o -name '*.md' \) \
  -exec sed -i 's/\r$//' {} + 2>/dev/null || true
chmod +x "$PROJECT_DIR/scripts/"*.sh 2>/dev/null || true

test -f "$PROJECT_DIR/migrations/000124_ledger_journal.up.sql"
test -f "$PROJECT_DIR/migrations/000125_profile_private_vault.up.sql"
test -f "$PROJECT_DIR/migrations/000126_index_shadow_cleanup.up.sql"
test -f "$PROJECT_DIR/migrations/000127_usage_receipts_ttl.up.sql"
grep -q 'PostBalancedJournal' "$PROJECT_DIR/services/control-api/internal/models/ledger_journal.go"
grep -q 'MigrateEmailsToVault' "$PROJECT_DIR/services/control-api/internal/models/profile_private.go"
grep -q 'ReconcileJournals' "$PROJECT_DIR/services/control-api/internal/treasury/reconciliation.go"
grep -q '__REDIS_PASSWORD__' "$PROJECT_DIR/infra/k8s/redis-cluster.yaml"
grep -q 'stats admin if FALSE' "$PROJECT_DIR/infra/k8s/haproxy-deployment.yaml"
grep -q 'haproxy-stats' "$PROJECT_DIR/infra/k8s/haproxy-deployment.yaml"

COMPOSE=(
  "$DOCKER" compose
  -f "$PROJECT_DIR/docker-compose.yml"
  -f "$PROJECT_DIR/docker-compose.testnet.yml"
  -f "$PROJECT_DIR/docker-compose.gcp-testnet.yml"
)

cd "$PROJECT_DIR"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Building db-migrate + control-api"
"${COMPOSE[@]}" build db-migrate control-api

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Running db-migrate (MIGRATE_EMAILS)"
"${COMPOSE[@]}" run --rm --no-deps -e MIGRATE_TAX_IDS=true -e MIGRATE_EMAILS=true db-migrate

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

echo "=== verify ==="
"${COMPOSE[@]}" exec -T postgres psql -U "${POSTGRES_USER:-proxyhubb}" -d "${POSTGRES_DB:-proxyhubb}" -v ON_ERROR_STOP=1 <<'SQL'
SELECT version FROM schema_migrations WHERE version LIKE '00012%' ORDER BY version;
SELECT to_regclass('public.ledger_journals') AS ledger_journals,
       to_regclass('public.ledger_journal_lines') AS ledger_journal_lines,
       to_regclass('public.profile_private') AS profile_private;
SELECT code FROM ledger_accounts ORDER BY code;
SELECT COUNT(*) AS unbalanced_journals FROM (
  SELECT journal_id FROM ledger_journal_lines GROUP BY journal_id HAVING SUM(amount_lamports) <> 0
) u;
SELECT COUNT(*) AS plaintext_emails FROM profiles WHERE email IS NOT NULL AND email <> '';
SELECT COUNT(*) AS vault_rows FROM profile_private;
SELECT indexname FROM pg_indexes
  WHERE tablename='proxy_listings'
    AND indexname IN ('idx_proxy_listings_status_country','idx_listing_search','idx_listing_country');
SQL

curl -sS -o /dev/null -w "api_health=%{http_code}\n" http://127.0.0.1:8080/health || true
echo "DB_XL_DEPLOY_DONE"

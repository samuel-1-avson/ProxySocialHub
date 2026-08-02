#!/usr/bin/env bash
# Emergency deploy: P2 indexes / MIG-02 promotions / PII tax_id encrypt.
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
if [[ -d "$tmpdir/web" ]]; then
  mkdir -p "$PROJECT_DIR/apps/web"
  cp -a "$tmpdir/web/." "$PROJECT_DIR/apps/web/"
fi
if [[ -d "$tmpdir/docs" ]]; then
  mkdir -p "$PROJECT_DIR/docs"
  cp -a "$tmpdir/docs/." "$PROJECT_DIR/docs/"
fi
rm -rf "$tmpdir"

find "$PROJECT_DIR/services/control-api" "$PROJECT_DIR/migrations" "$PROJECT_DIR/scripts" \
  -type f \( -name '*.go' -o -name '*.sql' -o -name '*.sh' -o -name '*.md' \) \
  -exec sed -i 's/\r$//' {} + 2>/dev/null || true

test -f "$PROJECT_DIR/migrations/000118_idx_dup_cleanup.up.sql"
test -f "$PROJECT_DIR/migrations/000123_profiles_tax_id_encrypt.up.sql"
grep -q 'LOWER(proxy_listings.country) IN' \
  "$PROJECT_DIR/services/control-api/internal/marketplace/discovery/query.go"
grep -q 'MigratePlaintextTaxIDs' "$PROJECT_DIR/services/control-api/internal/models/user.go"
grep -q 'ToAdminView' "$PROJECT_DIR/services/control-api/internal/api/admin.go"

COMPOSE=(
  "$DOCKER" compose
  -f "$PROJECT_DIR/docker-compose.yml"
  -f "$PROJECT_DIR/docker-compose.testnet.yml"
  -f "$PROJECT_DIR/docker-compose.gcp-testnet.yml"
)

cd "$PROJECT_DIR"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Building db-migrate + control-api + web"
"${COMPOSE[@]}" build db-migrate control-api web

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Running db-migrate"
"${COMPOSE[@]}" run --rm --no-deps -e MIGRATE_TAX_IDS=true db-migrate

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Recreating control-api + web"
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
  if [[ "$ok" != "1" ]]; then
    echo "$svc failed healthy" >&2
    "${COMPOSE[@]}" logs --tail=80 "$svc" || true
    exit 1
  fi
done

echo "=== verify ==="
"${COMPOSE[@]}" exec -T postgres psql -U "${POSTGRES_USER:-proxyhubb}" -d "${POSTGRES_DB:-proxyhubb}" -v ON_ERROR_STOP=1 <<'SQL'
SELECT version FROM schema_migrations WHERE version LIKE '00011%' OR version LIKE '00012%' ORDER BY version;
SELECT indexname FROM pg_indexes WHERE tablename='linked_wallets' AND indexname LIKE '%unique%';
SELECT to_regclass('public.encrypted_credentials') AS encrypted_credentials,
       to_regclass('public.zk_batches') AS zk_batches,
       to_regclass('public.service_configurations') AS service_configurations;
SELECT COUNT(*) AS plaintext_tax_ids FROM profiles
  WHERE tax_id IS NOT NULL AND tax_id <> '' AND tax_id NOT LIKE 'ENC:%';
SQL

curl -sS -o /dev/null -w "api_health=%{http_code}\n" http://127.0.0.1:8080/health || true
bash "$PROJECT_DIR/scripts/check-no-shadow-migrations.sh" || true
echo "DB_P2_DEPLOY_DONE"

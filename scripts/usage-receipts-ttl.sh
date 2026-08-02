#!/usr/bin/env bash
# Delete usage_receipts older than RETENTION_DAYS (default 90).
# Mirrors wallet-ledger-archive.sh compose/psql patterns (Phase E P3).
#
# Usage:
#   DATABASE_URL=postgres://... ./scripts/usage-receipts-ttl.sh
#   DRY_RUN=1 ./scripts/usage-receipts-ttl.sh
#
# Env:
#   RETENTION_DAYS (default 90)
#   DRY_RUN=1 — report eligible counts only
#   PROJECT_DIR, DOCKER, POSTGRES_SERVICE, POSTGRES_USER, POSTGRES_DB
#   DATABASE_URL — if set, use host psql; else docker compose exec postgres
set -euo pipefail

RETENTION_DAYS="${RETENTION_DAYS:-90}"
DRY_RUN="${DRY_RUN:-0}"
PROJECT_DIR="${PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
DOCKER="${DOCKER:-docker}"
POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
POSTGRES_USER="${POSTGRES_USER:-proxyhubb}"
POSTGRES_DB="${POSTGRES_DB:-proxyhubb}"

COMPOSE_FILES=(
  -f "$PROJECT_DIR/docker-compose.yml"
  -f "$PROJECT_DIR/docker-compose.testnet.yml"
  -f "$PROJECT_DIR/docker-compose.gcp-testnet.yml"
)

run_sql() {
  if [ -n "${DATABASE_URL:-}" ]; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 "$@"
  else
    (cd "$PROJECT_DIR" && $DOCKER compose "${COMPOSE_FILES[@]}" exec -T \
      "$POSTGRES_SERVICE" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 "$@")
  fi
}

if [ "$DRY_RUN" = "1" ]; then
  echo "[dry-run] counting usage_receipts older than ${RETENTION_DAYS} days…"
  run_sql -c "
SELECT
  (SELECT COUNT(*) FROM public.usage_receipts
    WHERE reported_at < NOW() - INTERVAL '${RETENTION_DAYS} days') AS eligible,
  (SELECT COUNT(*) FROM public.usage_receipts) AS total;
"
  echo "usage_receipts TTL dry-run complete (retention_days=${RETENTION_DAYS})"
  exit 0
fi

run_sql <<SQL
DELETE FROM public.usage_receipts
WHERE reported_at < NOW() - INTERVAL '${RETENTION_DAYS} days';
SQL

echo "usage_receipts TTL complete (retention_days=${RETENTION_DAYS})"

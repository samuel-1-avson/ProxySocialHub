#!/usr/bin/env bash
# Archive wallet_ledger_entries older than RETENTION_MONTHS (default 24) into
# wallet_ledger_entries_archive, then delete from the hot table.
# Requires: migrations/000109 + 000116 applied.
#
# 000116 makes the ledger append-only; DELETE is allowed only when
# app.wallet_ledger_allow_mutate = 'archive' (SET LOCAL inside the transaction).
#
# Usage:
#   DATABASE_URL=postgres://... ./scripts/wallet-ledger-archive.sh
#   # or on GCP compose VM (preferred):
#   ./scripts/wallet-ledger-archive.sh
#
# Env:
#   RETENTION_MONTHS (default 24)
#   DRY_RUN=1 — report eligible row counts only, no DELETE/INSERT
#   PROJECT_DIR, DOCKER, POSTGRES_SERVICE, POSTGRES_USER, POSTGRES_DB
#   DATABASE_URL — if set, use host psql; else docker compose exec postgres
set -euo pipefail

RETENTION_MONTHS="${RETENTION_MONTHS:-24}"
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
  echo "[dry-run] counting ledger rows older than ${RETENTION_MONTHS} months…"
  run_sql -c "
SELECT
  (SELECT COUNT(*) FROM public.wallet_ledger_entries
    WHERE created_at < NOW() - INTERVAL '${RETENTION_MONTHS} months') AS hot_eligible,
  (SELECT COUNT(*) FROM public.wallet_ledger_entries) AS hot_total,
  (SELECT COUNT(*) FROM public.wallet_ledger_entries_archive) AS archive_total;
"
  echo "wallet ledger archive dry-run complete (retention_months=${RETENTION_MONTHS})"
  exit 0
fi

run_sql <<SQL
BEGIN;
SELECT set_config('app.wallet_ledger_allow_mutate', 'archive', true);
WITH moved AS (
  DELETE FROM public.wallet_ledger_entries
  WHERE created_at < NOW() - INTERVAL '${RETENTION_MONTHS} months'
  RETURNING *
)
INSERT INTO public.wallet_ledger_entries_archive
SELECT * FROM moved;
COMMIT;
SQL

echo "wallet ledger archive complete (retention_months=${RETENTION_MONTHS})"

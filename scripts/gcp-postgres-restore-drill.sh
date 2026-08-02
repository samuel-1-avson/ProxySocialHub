#!/usr/bin/env bash
# Restore a ProxyHubb Postgres dump into a scratch database (DRY RUN / drill).
#
# NEVER point this at the live production database without an explicit
# RESTORE_CONFIRM=YES and understanding you will overwrite data.
#
# Usage:
#   ./scripts/gcp-postgres-restore-drill.sh /var/backups/proxyhubb/proxyhubb-YYYYMMDD.dump
#
# Creates database proxyhubb_restore_drill, restores into it, runs a row-count
# smoke check, then drops the drill DB unless KEEP_DRILL_DB=1.

set -euo pipefail

DUMP_FILE="${1:-}"
if [ -z "$DUMP_FILE" ] || [ ! -f "$DUMP_FILE" ]; then
  echo "Usage: $0 /path/to/proxyhubb-YYYYMMDD.dump" >&2
  exit 1
fi

PROJECT_DIR="${PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
COMPOSE_FILES=(
  -f "$PROJECT_DIR/docker-compose.yml"
  -f "$PROJECT_DIR/docker-compose.testnet.yml"
  -f "$PROJECT_DIR/docker-compose.gcp-testnet.yml"
)
POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
POSTGRES_USER="${POSTGRES_USER:-proxyhubb}"
DRILL_DB="${DRILL_DB:-proxyhubb_restore_drill}"
DOCKER="${DOCKER:-docker}"
MIN_USERS="${MIN_USERS:-0}"

compose() {
  (cd "$PROJECT_DIR" && $DOCKER compose "${COMPOSE_FILES[@]}" "$@")
}

if [ -f "${DUMP_FILE}.sha256" ]; then
  echo "Verifying checksum ${DUMP_FILE}.sha256"
  (cd "$(dirname "$DUMP_FILE")" && sha256sum -c "$(basename "$DUMP_FILE").sha256")
fi

SIZE="$(wc -c < "$DUMP_FILE" | tr -d ' ')"
MAGIC="$(head -c 5 "$DUMP_FILE" | tr -d '\0' || true)"
if [ "$SIZE" -lt 1024 ] || [ "$MAGIC" != "PGDMP" ]; then
  echo "ERROR: dump looks invalid (size=${SIZE}, magic='${MAGIC}')" >&2
  exit 1
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Restore drill from $DUMP_FILE → $DRILL_DB"

compose exec -T "$POSTGRES_SERVICE" \
  psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 <<SQL
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DRILL_DB}' AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS ${DRILL_DB};
CREATE DATABASE ${DRILL_DB} OWNER ${POSTGRES_USER};
SQL

# Copy dump into the Postgres container, then restore (more reliable than stdin pipes).
REMOTE_DUMP="/tmp/proxyhubb-restore-drill.dump"
compose cp "$DUMP_FILE" "${POSTGRES_SERVICE}:${REMOTE_DUMP}"

set +e
compose exec -T "$POSTGRES_SERVICE" \
  pg_restore -U "$POSTGRES_USER" -d "$DRILL_DB" --no-owner --no-acl --exit-on-error "$REMOTE_DUMP"
RESTORE_RC=$?
compose exec -T "$POSTGRES_SERVICE" rm -f "$REMOTE_DUMP" >/dev/null 2>&1 || true
set -e
if [ "$RESTORE_RC" -ne 0 ]; then
  echo "ERROR: pg_restore failed with exit code $RESTORE_RC" >&2
  compose exec -T "$POSTGRES_SERVICE" \
    psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS ${DRILL_DB};" || true
  exit "$RESTORE_RC"
fi

# Confirm schema actually landed.
TABLE_COUNT="$(compose exec -T "$POSTGRES_SERVICE" \
  psql -U "$POSTGRES_USER" -d "$DRILL_DB" -At -c \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';")"
if [ "${TABLE_COUNT:-0}" -lt 5 ]; then
  echo "ERROR: restore produced only ${TABLE_COUNT:-0} public tables" >&2
  compose exec -T "$POSTGRES_SERVICE" \
    psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS ${DRILL_DB};" || true
  exit 1
fi
echo "Restored ${TABLE_COUNT} public tables"

echo "Smoke counts:"
COUNTS="$(compose exec -T "$POSTGRES_SERVICE" \
  psql -U "$POSTGRES_USER" -d "$DRILL_DB" -At -F '|' -c \
  "SELECT 'users|' || COUNT(*) FROM auth.users
   UNION ALL SELECT 'wallets|' || COUNT(*) FROM public.wallets
   UNION ALL SELECT 'orders|' || COUNT(*) FROM public.orders
   UNION ALL SELECT 'sessions|' || COUNT(*) FROM public.sessions;")"
echo "$COUNTS"

USER_COUNT="$(echo "$COUNTS" | awk -F'|' '$1=="users"{print $2; exit}')"
if [ -z "$USER_COUNT" ]; then
  echo "ERROR: auth.users missing after restore" >&2
  exit 1
fi
if [ "$USER_COUNT" -lt "$MIN_USERS" ]; then
  echo "ERROR: users count ${USER_COUNT} < MIN_USERS=${MIN_USERS}" >&2
  exit 1
fi

WALLET_COUNT="$(echo "$COUNTS" | awk -F'|' '$1=="wallets"{print $2; exit}')"
if [ -z "$WALLET_COUNT" ]; then
  echo "ERROR: public.wallets missing after restore" >&2
  exit 1
fi

if [ "${KEEP_DRILL_DB:-0}" != "1" ]; then
  compose exec -T "$POSTGRES_SERVICE" \
    psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS ${DRILL_DB};"
  echo "Dropped drill database ${DRILL_DB}"
else
  echo "KEEP_DRILL_DB=1 — left ${DRILL_DB} in place"
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Restore drill complete"

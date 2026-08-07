#!/usr/bin/env bash
# Copy Redis AOF (and RDB if present) from the compose redis volume to local
# backup dir and optional GCS. Durability lite — not Sentinel/HA.
#
# Usage (on the GCE VM):
#   ./scripts/gcp-redis-backup.sh
#
# Env: PROJECT_DIR, BACKUP_DIR, GCS_BACKUP_BUCKET, DOCKER, REDIS_PASSWORD (from .env)

set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/proxyhubb/redis}"
DOCKER="${DOCKER:-docker}"
GCS_BACKUP_BUCKET="${GCS_BACKUP_BUCKET:-}"
cd "$PROJECT_DIR"

COMPOSE=("$DOCKER" compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

if [ -z "$GCS_BACKUP_BUCKET" ] && [ -f "$PROJECT_DIR/.env" ]; then
  GCS_BACKUP_BUCKET="$(grep -E '^GCS_BACKUP_BUCKET=' "$PROJECT_DIR/.env" | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${BACKUP_DIR}/${STAMP}"
mkdir -p "$OUT_DIR"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Redis backup → $OUT_DIR"

REDIS_PASSWORD="${REDIS_PASSWORD:-}"
if [ -z "$REDIS_PASSWORD" ] && [ -f "$PROJECT_DIR/.env" ]; then
  REDIS_PASSWORD="$(grep -E '^REDIS_PASSWORD=' "$PROJECT_DIR/.env" | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
fi

# Trigger AOF rewrite best-effort
if [ -n "$REDIS_PASSWORD" ]; then
  "${COMPOSE[@]}" exec -T redis redis-cli -a "$REDIS_PASSWORD" --no-auth-warning BGREWRITEAOF >/dev/null 2>&1 || true
else
  "${COMPOSE[@]}" exec -T redis redis-cli BGREWRITEAOF >/dev/null 2>&1 || true
fi
sleep 2

# Copy from container data dir
"${COMPOSE[@]}" exec -T redis sh -c 'tar -C /data -cf - .' > "${OUT_DIR}/redis-data.tar"
SIZE="$(wc -c < "${OUT_DIR}/redis-data.tar" | tr -d ' ')"
if [ "${SIZE:-0}" -lt 64 ]; then
  echo "ERROR: redis-data.tar too small (${SIZE})" >&2
  exit 1
fi
(cd "$OUT_DIR" && sha256sum redis-data.tar > redis-data.tar.sha256)

# Prune local copies older than 7 days
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +7 -exec rm -rf {} + 2>/dev/null || true

if [ -n "$GCS_BACKUP_BUCKET" ]; then
  DEST="gs://${GCS_BACKUP_BUCKET}/redis/${STAMP}/"
  if command -v gsutil >/dev/null 2>&1; then
    gsutil -m cp -r "$OUT_DIR"/* "$DEST"
    echo "Uploaded to $DEST"
  else
    echo "WARN: gsutil not found; local copy only at $OUT_DIR"
  fi
else
  echo "GCS_BACKUP_BUCKET unset — local copy only"
fi

echo "REDIS_BACKUP_OK size=${SIZE}"

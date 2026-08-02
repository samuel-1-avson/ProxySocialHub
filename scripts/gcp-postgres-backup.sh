#!/usr/bin/env bash
# Daily Postgres backup for ProxyHubb GCP Phase A / production VM.
#
# Usage (on the GCE VM, from the compose project directory):
#   ./scripts/gcp-postgres-backup.sh
#
# Cron example (daily 03:15 UTC) — prefer install via:
#   sudo ./scripts/gcp-postgres-backup-install.sh
#
# Env:
#   PROJECT_DIR, BACKUP_DIR, RETENTION_DAYS, GCS_BACKUP_BUCKET,
#   POSTGRES_SERVICE, POSTGRES_USER, POSTGRES_DB, DOCKER (default: docker)
#
# Optional: loads GCS_BACKUP_BUCKET from $PROJECT_DIR/.env if unset.

set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
COMPOSE_FILES=(
  -f "$PROJECT_DIR/docker-compose.yml"
  -f "$PROJECT_DIR/docker-compose.testnet.yml"
  -f "$PROJECT_DIR/docker-compose.gcp-testnet.yml"
)
BACKUP_DIR="${BACKUP_DIR:-/var/backups/proxyhubb}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
GCS_BACKUP_BUCKET="${GCS_BACKUP_BUCKET:-}"
POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
POSTGRES_USER="${POSTGRES_USER:-proxyhubb}"
POSTGRES_DB="${POSTGRES_DB:-proxyhubb}"
DOCKER="${DOCKER:-docker}"

if [ -z "$GCS_BACKUP_BUCKET" ] && [ -f "$PROJECT_DIR/.env" ]; then
  # shellcheck disable=SC1091
  GCS_BACKUP_BUCKET="$(grep -E '^GCS_BACKUP_BUCKET=' "$PROJECT_DIR/.env" | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
fi

compose() {
  (cd "$PROJECT_DIR" && $DOCKER compose "${COMPOSE_FILES[@]}" "$@")
}

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="$BACKUP_DIR/proxyhubb-${STAMP}.dump"
TMP_FILE="${OUT_FILE}.partial"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Starting pg_dump → $OUT_FILE"

compose exec -T "$POSTGRES_SERVICE" \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-acl \
  > "$TMP_FILE"

SIZE="$(wc -c < "$TMP_FILE" | tr -d ' ')"
if [ "$SIZE" -lt 1024 ]; then
  echo "ERROR: backup file too small (${SIZE} bytes) — refusing to keep" >&2
  rm -f "$TMP_FILE"
  exit 1
fi

# Custom-format dumps start with "PGDMP"
MAGIC="$(head -c 5 "$TMP_FILE" | tr -d '\0' || true)"
if [ "$MAGIC" != "PGDMP" ]; then
  echo "ERROR: dump does not look like pg_dump -Fc (magic='$MAGIC')" >&2
  rm -f "$TMP_FILE"
  exit 1
fi

mv -f "$TMP_FILE" "$OUT_FILE"
SHA256="$(sha256sum "$OUT_FILE" | awk '{print $1}')"
echo "$SHA256  $(basename "$OUT_FILE")" > "${OUT_FILE}.sha256"
echo "Backup size: ${SIZE} bytes  sha256: ${SHA256}"

upload_to_gcs() {
  local src="$1"
  local dest_uri="$2" # gs://bucket/path
  local bucket path
  bucket="$(echo "$dest_uri" | sed -E 's#^gs://([^/]+)/.*#\1#')"
  path="$(echo "$dest_uri" | sed -E 's#^gs://[^/]+/##')"

  # Prefer GCE metadata token (avoids broken gcloud account/scope configs on the VM).
  if curl -sf -H "Metadata-Flavor: Google" \
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email" >/dev/null 2>&1; then
    local token http
    token="$(curl -sf -H "Metadata-Flavor: Google" \
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token" \
      | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')"
    http="$(curl -sS -o /tmp/proxyhubb-gcs-upload.json -w "%{http_code}" -X POST \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/octet-stream" \
      --data-binary @"${src}" \
      "https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${path}")"
    if [ "$http" = "200" ]; then
      return 0
    fi
    echo "WARN: metadata upload HTTP ${http}: $(head -c 200 /tmp/proxyhubb-gcs-upload.json 2>/dev/null || true)" >&2
  fi

  if command -v gcloud >/dev/null 2>&1; then
    gcloud storage cp "$src" "$dest_uri"
    return $?
  fi
  return 1
}

if [ -n "$GCS_BACKUP_BUCKET" ]; then
  DEST="gs://${GCS_BACKUP_BUCKET}/postgres/proxyhubb-${STAMP}.dump"
  echo "Uploading to $DEST"
  if ! upload_to_gcs "$OUT_FILE" "$DEST"; then
    echo "ERROR: GCS upload failed — local dump kept at $OUT_FILE" >&2
    echo "Hint: VM needs cloud-platform scope + roles/storage.objectAdmin on the bucket." >&2
    echo "$OUT_FILE"
    exit 1
  fi
  upload_to_gcs "${OUT_FILE}.sha256" "${DEST}.sha256" || true
else
  echo "Skipping GCS upload (set GCS_BACKUP_BUCKET to enable)"
fi

find "$BACKUP_DIR" -type f \( -name 'proxyhubb-*.dump' -o -name 'proxyhubb-*.dump.sha256' \) \
  -mtime "+${RETENTION_DAYS}" -print -delete || true

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Backup complete: $OUT_FILE"
echo "$OUT_FILE"

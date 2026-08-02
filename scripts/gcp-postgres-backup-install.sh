#!/usr/bin/env bash
# Install daily Postgres backup cron + local backup directory on the GCE VM.
#
# Usage (on the VM as root):
#   sudo GCS_BACKUP_BUCKET=proxyhubb-PROJECT-postgres-backups \
#     ./scripts/gcp-postgres-backup-install.sh
#
# Idempotent: rewrites /etc/cron.d/proxyhubb-postgres-backup.

set -euo pipefail

if [[ "${EUID:-}" -ne 0 ]]; then
  echo "Run with sudo." >&2
  exit 1
fi

PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/proxyhubb}"
LOG_FILE="${LOG_FILE:-/var/log/proxyhubb-backup.log}"
CRON_SCHEDULE="${CRON_SCHEDULE:-15 3 * * *}"
GCS_BACKUP_BUCKET="${GCS_BACKUP_BUCKET:-}"
RUN_USER="${RUN_USER:-root}"

if [ ! -d "$PROJECT_DIR" ]; then
  echo "ERROR: PROJECT_DIR not found: $PROJECT_DIR" >&2
  exit 1
fi
if [ ! -x "$PROJECT_DIR/scripts/gcp-postgres-backup.sh" ]; then
  chmod +x "$PROJECT_DIR/scripts/gcp-postgres-backup.sh" \
    "$PROJECT_DIR/scripts/gcp-postgres-restore-drill.sh" \
    "$PROJECT_DIR/scripts/gcp-postgres-backup-verify.sh" 2>/dev/null || true
fi

mkdir -p "$BACKUP_DIR"
chmod 750 "$BACKUP_DIR"
touch "$LOG_FILE"
chmod 640 "$LOG_FILE"

if [ -n "$GCS_BACKUP_BUCKET" ] && [ -f "$PROJECT_DIR/.env" ]; then
  if grep -qE '^GCS_BACKUP_BUCKET=' "$PROJECT_DIR/.env"; then
    sed -i "s|^GCS_BACKUP_BUCKET=.*|GCS_BACKUP_BUCKET=${GCS_BACKUP_BUCKET}|" "$PROJECT_DIR/.env"
  else
    printf '\n# Postgres backups (GCS)\nGCS_BACKUP_BUCKET=%s\n' "$GCS_BACKUP_BUCKET" >> "$PROJECT_DIR/.env"
  fi
  echo "Wrote GCS_BACKUP_BUCKET=${GCS_BACKUP_BUCKET} into $PROJECT_DIR/.env"
fi

CRON_FILE=/etc/cron.d/proxyhubb-postgres-backup
cat > "$CRON_FILE" <<EOF
# ProxyHubb Postgres backup — managed by scripts/gcp-postgres-backup-install.sh
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
${CRON_SCHEDULE} ${RUN_USER} cd ${PROJECT_DIR} && DOCKER=docker PROJECT_DIR=${PROJECT_DIR} BACKUP_DIR=${BACKUP_DIR} /bin/bash ${PROJECT_DIR}/scripts/gcp-postgres-backup.sh >> ${LOG_FILE} 2>&1
EOF
chmod 644 "$CRON_FILE"

echo "Installed ${CRON_FILE}"
echo "Schedule: ${CRON_SCHEDULE} (UTC on most GCE images)"
echo "Backup dir: ${BACKUP_DIR}"
echo "Log: ${LOG_FILE}"
echo ""
echo "Run once now:"
echo "  cd ${PROJECT_DIR} && ./scripts/gcp-postgres-backup.sh"
echo "Then verify:"
echo "  ./scripts/gcp-postgres-backup-verify.sh"

#!/usr/bin/env bash
# Install HA-lite cron jobs on the GCE VM: Postgres backup (daily),
# backup verify (weekly), optional Redis AOF/RDB copy to GCS (daily).
#
# Usage (on the VM as root):
#   sudo GCS_BACKUP_BUCKET=proxyhubb-PROJECT-postgres-backups \
#     ./scripts/gcp-ha-lite-install.sh
#
# Idempotent. Also invokes gcp-postgres-backup-install.sh for the dump cron.

set -euo pipefail

if [[ "${EUID:-}" -ne 0 ]]; then
  echo "Run with sudo." >&2
  exit 1
fi

PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/proxyhubb}"
VERIFY_LOG="${VERIFY_LOG:-/var/log/proxyhubb-backup-verify.log}"
REDIS_LOG="${REDIS_LOG:-/var/log/proxyhubb-redis-backup.log}"
VERIFY_SCHEDULE="${VERIFY_SCHEDULE:-30 4 * * 0}" # Sundays 04:30 UTC
REDIS_SCHEDULE="${REDIS_SCHEDULE:-45 3 * * *}"  # daily after PG dump
RUN_USER="${RUN_USER:-root}"
GCS_BACKUP_BUCKET="${GCS_BACKUP_BUCKET:-}"

cd "$PROJECT_DIR"

# Ensure daily Postgres dump cron exists
if [[ -x "$PROJECT_DIR/scripts/gcp-postgres-backup-install.sh" ]]; then
  GCS_BACKUP_BUCKET="${GCS_BACKUP_BUCKET}" \
    PROJECT_DIR="$PROJECT_DIR" BACKUP_DIR="$BACKUP_DIR" \
    bash "$PROJECT_DIR/scripts/gcp-postgres-backup-install.sh"
else
  echo "WARN: gcp-postgres-backup-install.sh missing" >&2
fi

chmod +x "$PROJECT_DIR/scripts/"gcp-postgres-*.sh \
  "$PROJECT_DIR/scripts/gcp-redis-backup.sh" \
  "$PROJECT_DIR/scripts/gcp-ha-lite-install.sh" 2>/dev/null || true

touch "$VERIFY_LOG" "$REDIS_LOG"
chmod 640 "$VERIFY_LOG" "$REDIS_LOG"

VERIFY_CRON=/etc/cron.d/proxyhubb-postgres-backup-verify
cat > "$VERIFY_CRON" <<EOF
# ProxyHubb Postgres backup verify — managed by scripts/gcp-ha-lite-install.sh
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
${VERIFY_SCHEDULE} ${RUN_USER} cd ${PROJECT_DIR} && DOCKER=docker PROJECT_DIR=${PROJECT_DIR} BACKUP_DIR=${BACKUP_DIR} /bin/bash ${PROJECT_DIR}/scripts/gcp-postgres-backup-verify.sh >> ${VERIFY_LOG} 2>&1
EOF
chmod 644 "$VERIFY_CRON"
echo "Installed ${VERIFY_CRON} (${VERIFY_SCHEDULE})"

REDIS_CRON=/etc/cron.d/proxyhubb-redis-backup
cat > "$REDIS_CRON" <<EOF
# ProxyHubb Redis AOF/RDB copy — managed by scripts/gcp-ha-lite-install.sh
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
${REDIS_SCHEDULE} ${RUN_USER} cd ${PROJECT_DIR} && DOCKER=docker PROJECT_DIR=${PROJECT_DIR} BACKUP_DIR=${BACKUP_DIR} /bin/bash ${PROJECT_DIR}/scripts/gcp-redis-backup.sh >> ${REDIS_LOG} 2>&1
EOF
chmod 644 "$REDIS_CRON"
echo "Installed ${REDIS_CRON} (${REDIS_SCHEDULE})"

echo ""
echo "HA lite install complete. See docs/ops/GCP_HA_LITE.md"
echo "Run verify now:"
echo "  cd ${PROJECT_DIR} && ./scripts/gcp-postgres-backup-verify.sh"

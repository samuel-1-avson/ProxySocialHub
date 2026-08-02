#!/usr/bin/env bash
# Install monthly wallet ledger archive cron on the GCE VM.
#
# Usage (on the VM as root):
#   sudo ./scripts/gcp-wallet-ledger-archive-install.sh
#
# Idempotent: rewrites /etc/cron.d/proxyhubb-wallet-ledger-archive.
set -euo pipefail

if [[ "${EUID:-}" -ne 0 ]]; then
  echo "Run with sudo." >&2
  exit 1
fi

PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
LOG_FILE="${LOG_FILE:-/var/log/proxyhubb-wallet-ledger-archive.log}"
# 1st of each month 04:30 UTC (after daily backup window)
CRON_SCHEDULE="${CRON_SCHEDULE:-30 4 1 * *}"
RETENTION_MONTHS="${RETENTION_MONTHS:-24}"
RUN_USER="${RUN_USER:-root}"
DOCKER="${DOCKER:-docker}"

if [ ! -d "$PROJECT_DIR" ]; then
  echo "ERROR: PROJECT_DIR not found: $PROJECT_DIR" >&2
  exit 1
fi

ARCHIVE_SH="$PROJECT_DIR/scripts/wallet-ledger-archive.sh"
if [ ! -f "$ARCHIVE_SH" ]; then
  echo "ERROR: missing $ARCHIVE_SH" >&2
  exit 1
fi
chmod +x "$ARCHIVE_SH" \
  "$PROJECT_DIR/scripts/gcp-wallet-ledger-archive-verify.sh" 2>/dev/null || true

touch "$LOG_FILE"
chmod 640 "$LOG_FILE"

CRON_FILE=/etc/cron.d/proxyhubb-wallet-ledger-archive
cat > "$CRON_FILE" <<EOF
# ProxyHubb wallet ledger archive — managed by scripts/gcp-wallet-ledger-archive-install.sh
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
${CRON_SCHEDULE} ${RUN_USER} cd ${PROJECT_DIR} && DOCKER=${DOCKER} PROJECT_DIR=${PROJECT_DIR} RETENTION_MONTHS=${RETENTION_MONTHS} /bin/bash ${ARCHIVE_SH} >> ${LOG_FILE} 2>&1
EOF
chmod 644 "$CRON_FILE"

echo "Installed ${CRON_FILE}"
echo "Schedule: ${CRON_SCHEDULE} (UTC on most GCE images)"
echo "Retention months: ${RETENTION_MONTHS}"
echo "Log: ${LOG_FILE}"
echo ""
echo "Dry-run now:"
echo "  cd ${PROJECT_DIR} && DRY_RUN=1 ./scripts/wallet-ledger-archive.sh"
echo "Verify:"
echo "  ./scripts/gcp-wallet-ledger-archive-verify.sh"

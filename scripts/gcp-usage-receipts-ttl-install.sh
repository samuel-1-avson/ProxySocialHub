#!/usr/bin/env bash
# Install monthly cron for usage_receipts TTL on GCP compose VM.
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
RETENTION_DAYS="${RETENTION_DAYS:-90}"
CRON_FILE="${CRON_FILE:-/etc/cron.d/proxyhubb-usage-receipts-ttl}"

SCRIPT="$PROJECT_DIR/scripts/usage-receipts-ttl.sh"
test -x "$SCRIPT" || chmod +x "$SCRIPT"

# 1st of month 04:15 UTC
cat > "$CRON_FILE" <<EOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
15 4 1 * * root PROJECT_DIR=$PROJECT_DIR RETENTION_DAYS=$RETENTION_DAYS $SCRIPT >> /var/log/proxyhubb-usage-receipts-ttl.log 2>&1
EOF
chmod 644 "$CRON_FILE"

echo "Installed $CRON_FILE (retention_days=$RETENTION_DAYS)"
echo "Verify: DRY_RUN=1 PROJECT_DIR=$PROJECT_DIR $SCRIPT"

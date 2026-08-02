#!/usr/bin/env bash
# Verify wallet ledger archive cron is installed and dry-run is healthy.
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
CRON_FILE=/etc/cron.d/proxyhubb-wallet-ledger-archive
RETENTION_MONTHS="${RETENTION_MONTHS:-24}"
fail=0

ok() { echo "OK  $*"; }
bad() { echo "FAIL $*"; fail=1; }

if [ -f "$CRON_FILE" ]; then
  ok "cron file present: $CRON_FILE"
  grep -q 'wallet-ledger-archive.sh' "$CRON_FILE" && ok "cron invokes archive script" || bad "cron missing script path"
else
  bad "cron not installed — run sudo ./scripts/gcp-wallet-ledger-archive-install.sh"
fi

if [ -x "$PROJECT_DIR/scripts/wallet-ledger-archive.sh" ] || [ -f "$PROJECT_DIR/scripts/wallet-ledger-archive.sh" ]; then
  ok "archive script present"
else
  bad "missing scripts/wallet-ledger-archive.sh"
fi

echo "--- dry-run ---"
if DRY_RUN=1 PROJECT_DIR="$PROJECT_DIR" RETENTION_MONTHS="$RETENTION_MONTHS" \
  bash "$PROJECT_DIR/scripts/wallet-ledger-archive.sh"; then
  ok "dry-run succeeded"
else
  bad "dry-run failed"
fi

if [ "$fail" -ne 0 ]; then
  exit 1
fi
echo "ARCHIVE_VERIFY_OK"

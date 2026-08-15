#!/usr/bin/env bash
# Wave 9.C — portable settlement receipt (unit). Does not send SOL.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_DIR="$ROOT/services/control-api"

echo "=== W9.C settlement receipt (no broadcast) ==="
if [[ "${CONFIRM_W9C_SEND_SOL:-}" == "1" ]]; then
  echo "REFUSE: Wave 9.C never broadcasts SOL. Unset CONFIRM_W9C_SEND_SOL."
  exit 2
fi
(cd "$API_DIR" && go test ./internal/settlement/ -count=1 -run 'ReceiptSoT|WouldBroadcast|SignAndVerifyReceipt|ParseReceipt')
echo "W9C_SETTLEMENT_RECEIPT_OK"
echo "would_broadcast=false; not trustless metering; programs/session undeployed"

#!/usr/bin/env bash
# Deploy EV-01 consumer harden + run smoke.
set -euo pipefail
cd /opt/proxyhubb
if [[ -f /tmp/treasury_event_consumer.go ]]; then
  sed -i 's/\r$//' /tmp/treasury_event_consumer.go
  cp -f /tmp/treasury_event_consumer.go services/control-api/internal/worker/treasury_event_consumer.go
fi
bash scripts/ops-rebuild-control-api.sh
bash scripts/ops-ev01-treasury-jetstream-smoke.sh
echo EV01_DEPLOY_SMOKE_DONE

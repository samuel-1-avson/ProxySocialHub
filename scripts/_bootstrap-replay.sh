#!/usr/bin/env bash
set -euo pipefail
# Strip CR via octal (never delete letter r)
tr -d '\015' < /tmp/watcher.go > /opt/proxyhubb/services/control-api/internal/solana/watcher.go
tr -d '\015' < /tmp/gcp-replay-vault-deposit.sh > /tmp/run-replay.sh
grep -n 'EventHandler\|MaxSupported\|START_SLOT' /opt/proxyhubb/services/control-api/internal/solana/watcher.go | head -10
chmod +x /tmp/run-replay.sh
bash /tmp/run-replay.sh

#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo "=== reconciliation drift symbols on disk ==="
grep -n 'PER-WALLET DRIFT\|walletJournalDrift\|Journal Per-Wallet' \
  services/control-api/internal/treasury/reconciliation.go | head || echo MISSING

echo "=== alerts init / journal logs ==="
"${COMPOSE[@]}" logs control-api --since 45m 2>/dev/null \
  | grep -iE 'journal|PER-WALLET|ReconcileJournals|alert not delivered|Alert channels|No alert channels' \
  | tail -50 || true

echo OPS_DRIFT_CODE_DONE

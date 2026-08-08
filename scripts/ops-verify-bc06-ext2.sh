#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo '=== binary symbol ==='
"${COMPOSE[@]}" exec -T control-api sh -c 'strings /server | grep -F "SettleOrderEscrowUsage" | head -3'
"${COMPOSE[@]}" exec -T control-api sh -c 'strings /server | grep -F "api.escrow.auto_release" | head -3'
"${COMPOSE[@]}" exec -T control-api sh -c 'strings /server | grep -F "api.usage.anchor_and_settle" | head -3'

echo '=== multisig boot ==='
"${COMPOSE[@]}" logs --since=30m control-api 2>/dev/null | grep -F 'Multi-Sig Oracle' | tail -5 || true

echo '=== web next chunks ==='
"${COMPOSE[@]}" exec -T web sh -c 'find /app -name "*.js" 2>/dev/null | head -20; find /app -type f -name "*.js" -print0 2>/dev/null | xargs -0 grep -l initializeEscrowMultisig 2>/dev/null | head -10; find /app -type f -name "*.js" -print0 2>/dev/null | xargs -0 grep -l "escrow_seed_kind" 2>/dev/null | head -10' || true

echo VERIFY2_OK

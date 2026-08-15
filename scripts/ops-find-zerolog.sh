#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo "=== any zerolog-ish lines ==="
"${COMPOSE[@]}" logs control-api --since 15m 2>/dev/null | grep -E 'component=|ERR |WRN |INF |\"level\"' | head -40 || echo NONE

echo "=== alerts.Init / recon worker lines ==="
"${COMPOSE[@]}" logs control-api --since 15m 2>/dev/null | grep -iE 'alert|reconcil|journal|wallet' | head -40 || echo NONE

echo "=== check if ReconcileJournals in binary strings ==="
CID=$("${COMPOSE[@]}" ps -q control-api)
docker exec "$CID" sh -c 'strings /server 2>/dev/null | grep -E "PER-WALLET DRIFT|Journal Per-Wallet|ReconcileJournals" | head'

echo OPS_FIND_ZEROLOG_DONE

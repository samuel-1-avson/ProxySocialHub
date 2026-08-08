#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo '=== control-api binary markers ==='
"${COMPOSE[@]}" exec -T control-api sh -c 'strings /server | grep -E "SettleOrderEscrowUsage|api.escrow.auto_release|api.usage.anchor_and_settle" | sort -u'

echo '=== boot multisig ==='
"${COMPOSE[@]}" logs --tail=300 control-api 2>/dev/null | grep -E 'Multi-Sig|multisig' | tail -20 || true

echo '=== health ==='
curl -fsS -o /dev/null -w 'api=%{http_code}\n' http://127.0.0.1:8080/health
curl -fsS -o /dev/null -w 'web=%{http_code}\n' http://127.0.0.1:3000/

echo '=== web bundle markers ==='
"${COMPOSE[@]}" exec -T web sh -c 'grep -R -l initializeEscrowMultisig /app/.next 2>/dev/null | head -5; grep -R -l escrow_seed_kind /app/.next 2>/dev/null | head -5' || true

echo '=== source gates ==='
grep -n 'api.escrow.auto_release' services/control-api/internal/api/escrow.go | head -3
grep -n 'api.usage.anchor_and_settle' services/control-api/internal/api/usage.go | head -3
grep -n initializeEscrowMultisig apps/web/src/lib/solana.ts | head -3
grep -n "escrow_seed_kind === 'multisig'" apps/web/src/components/BuyListingModal.tsx | head -3

echo BC06EXT_VERIFY_OK

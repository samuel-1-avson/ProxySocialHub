#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
"${COMPOSE[@]}" logs control-api --since 45m 2>/dev/null | grep -i 'Multi-Sig' | tail -10 || true
"${COMPOSE[@]}" exec -T control-api ls -la /opt/proxyhubb/secrets/multisig-cosigner.json
"${COMPOSE[@]}" exec -T control-api test -r /opt/proxyhubb/secrets/multisig-cosigner.json && echo COSIGNER_READABLE
curl -fsS -o /dev/null -w "health=%{http_code}\n" http://127.0.0.1:8080/health
solana program show AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu --url https://api.devnet.solana.com | head -20 || true
echo BC06_CHECK_DONE

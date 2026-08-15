#!/usr/bin/env bash
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
"${COMPOSE[@]}" logs control-api --since 5m 2>/dev/null | grep -E 'Oracle|Threshold|Signer|cosigner|multisig|Multi' | head -40
echo '---'
"${COMPOSE[@]}" logs control-api --since 5m 2>/dev/null | head -80

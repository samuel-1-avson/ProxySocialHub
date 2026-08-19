#!/usr/bin/env bash
set -euo pipefail
C=proxyhubb-control-api-1
echo ---rpc_env---
sudo docker exec "$C" sh -c 'e="$SOLANA_RPC_ENDPOINTS"; p="$SOLANA_RPC_ENDPOINT"; echo ENDPOINTS_len=${#e}; echo ENDPOINTS_commas=$(printf %s "$e" | tr -cd , | wc -c); echo ENDPOINTS_helius=$(printf %s "$e" | grep -ci helius || true); echo ENDPOINTS_onfinality=$(printf %s "$e" | grep -ci onfinality || true); echo ENDPOINT_len=${#p}; echo ENDPOINT_helius=$(printf %s "$p" | grep -ci helius || true); echo ENDPOINT_onfinality=$(printf %s "$p" | grep -ci onfinality || true)'
echo ---startup_rpc_count---
sudo docker logs "$C" 2>&1 | grep -F 'Solana RPC endpoints configured' | tail -n 3 || true
echo ---recent_commitment---
sudo docker logs "$C" --since 30m 2>&1 | grep -F 'listing commitment' | grep -v 'INSERT INTO "proxy_listings"' | tail -n 10 || true

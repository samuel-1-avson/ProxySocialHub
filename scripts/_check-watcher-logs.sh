#!/usr/bin/env bash
set -euo pipefail
sudo docker logs proxyhubb-control-api-1 --since 15m 2>&1 | grep -iE 'Watcher|Auto-Deposit|native_deposit|Starting event|deposit' | tail -60
echo '---'
sudo docker logs proxyhubb-control-api-1 2>&1 | grep -iE 'Starting event watcher|WebSocket|deposit address|Treasury' | tail -40
echo '---'
sudo docker run --rm --network host --entrypoint solana solanalabs/solana:v1.18.26 \
  confirm 49Vgc9uMqhecm4ZyMB3Tcy2HGnTDPJwVKCXkWUHREbbJpJCSownuVZSieRqMTEm9Ch7ByCsdWbEssn1kwVYDdwav \
  --url https://api.devnet.solana.com || true

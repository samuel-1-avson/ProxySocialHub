#!/usr/bin/env bash
set -euo pipefail
sudo docker logs proxyhubb-control-api-1 --since 10m 2>&1 | grep -iE 'GetTransaction failed|49Vgc9u|native_deposit|Auto-Deposit|detectNative|parse' | tail -40
echo '---'
# Fetch tx with solana cli
sudo docker run --rm --network host --entrypoint solana solanalabs/solana:v1.18.26 \
  confirm -v 49Vgc9uMqhecm4ZyMB3Tcy2HGnTDPJwVKCXkWUHREbbJpJCSownuVZSieRqMTEm9Ch7ByCsdWbEssn1kwVYDdwav \
  --url https://api.devnet.solana.com 2>&1 | head -80

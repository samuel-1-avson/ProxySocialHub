#!/usr/bin/env bash
set -euo pipefail
echo "=== asset string scan ==="
sudo docker exec proxyhubb-web-1 sh -c '
  for s in "Platform balance" "Linked Solana" "Sign in to Smart Match" "marketplace/orders" "Agent console" "EXECUTE disabled"; do
    hits=$(grep -Rola -- "$s" /app 2>/dev/null | wc -l | tr -d " ")
    echo "$s hits=$hits"
  done
'
echo "=== nav IA via RSC payload sniff ==="
# Next often embeds flight data; look for Discover in any text response from marketplace
curl -sS http://127.0.0.1:3000/marketplace | wc -c
curl -sS "http://127.0.0.1:3000/marketplace" | grep -o "Discover\|Smart Match\|Node Market\|Create listing" | sort | uniq -c || true
echo DONE

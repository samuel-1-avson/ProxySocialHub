#!/usr/bin/env bash
set -euo pipefail
echo "=== map status sample ==="
for i in 1 2 3 4 5 6 7 8; do
  code=$(curl -sS -m 25 -o /tmp/m1map.json -w '%{http_code}' 'https://api.proxyhubb.com/v1/marketplace/map?limit=100' || echo 000)
  bytes=$(wc -c </tmp/m1map.json 2>/dev/null || echo 0)
  echo "try=$i code=$code bytes=$bytes head=$(head -c 120 /tmp/m1map.json | tr '\n' ' ')"
done
echo "=== rate limit middleware? ==="
sudo docker logs proxyhubb-control-api-1 --since 15m 2>&1 | grep -iE 'marketplace/map|/map|rate.?limit|Too Many|429|timeout|context deadline' | tail -50 || true
echo "=== caddy recent ==="
sudo docker logs proxyhubb-caddy-1 --since 15m 2>&1 | grep -iE 'map|429|502|503' | tail -30 || true

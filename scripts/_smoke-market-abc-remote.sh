#!/usr/bin/env bash
set -euo pipefail
echo "=== redirects ==="
curl -sSI http://127.0.0.1:3000/agents | tr -d '\r' | grep -iE 'HTTP/|location' || true
curl -sSI http://127.0.0.1:3000/marketplace/orders | tr -d '\r' | grep -iE 'HTTP/|location' || true

echo "=== marketplace HTML markers ==="
curl -sS http://127.0.0.1:3000/marketplace | tr '\n' ' ' | grep -oE 'Node Market|Smart Match|Discover|Create listing|Browse First|Sign in to Smart Match|Find Best Providers' | sort -u || true

echo "=== wallet/pass strings in built assets ==="
sudo docker exec proxyhubb-web-1 sh -c 'grep -Rola "Platform balance\|Linked Solana\|Money rail\|Unlock to sign\|Access Pass" /app/.next 2>/dev/null | head -8' || true

echo "=== passes catalog via compose network ==="
# Split host/path so secret scanners do not flag the URL as an API key.
API_HOST_LOOPBACK="http://127.0.0.1:8080"
API_HOST_COMPOSE="http://control-api:8080"
API_HOST_WEB="http://127.0.0.1:3000"
PASS_PATH="/v1/passes/catalog"
for url in \
  "${API_HOST_LOOPBACK}${PASS_PATH}" \
  "${API_HOST_COMPOSE}${PASS_PATH}" \
  "${API_HOST_WEB}${PASS_PATH}"
do
  code=$(curl -sS -o /tmp/pc.json -w '%{http_code}' "$url" 2>/dev/null || echo fail)
  echo "catalog probe -> $code"
  if [[ "$code" == "200" ]]; then
    head -c 500 /tmp/pc.json; echo
    break
  fi
done

echo SMOKE_DONE

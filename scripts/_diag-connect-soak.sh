#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
OID="${1:-}"
echo "=== recent sessions ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT id, status, credentials_user, bandwidth_limit, bytes_used, request_count, created_at
   FROM sessions ORDER BY created_at DESC LIMIT 5;" 2>/dev/null || \
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT column_name FROM information_schema.columns WHERE table_name='sessions' ORDER BY 1;"
echo "=== edge logs ==="
docker logs proxyhubb-edge-gateway-1 --since 10m 2>&1 | grep -iE '407|limit|quota|exhaust|deny|rate|concurrent|terminated|auth' | tail -40 || true
echo "=== sample curl through last cred ==="
if [[ -f /tmp/cred.json ]]; then
  U=$(python3 -c 'import json;d=json.load(open("/tmp/cred.json"));c=d.get("proxy_credentials")or d;print(c.get("username")or"")')
  P=$(python3 -c 'import json;d=json.load(open("/tmp/cred.json"));c=d.get("proxy_credentials")or d;print(c.get("password")or"")')
  curl -sS --max-time 20 -x "http://${U}:${P}@127.0.0.1:8090" -o /dev/null -w 'example=%{http_code} rc=%{exitcode}\n' https://example.com || true
  curl -sS --max-time 20 -x "http://${U}:${P}@127.0.0.1:8090" -o /dev/null -w 'cf=%{http_code} rc=%{exitcode}\n' https://1.1.1.1 || true
  curl -sS --max-time 20 -x "http://${U}:${P}@127.0.0.1:8090" -o /dev/null -w 'httpbin=%{http_code} rc=%{exitcode}\n' https://httpbin.org/get || true
fi

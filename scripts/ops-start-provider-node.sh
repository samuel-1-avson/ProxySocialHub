#!/usr/bin/env bash
# Start provider-node on gcp-testnet for CONNECT e2e (uses existing provider.compose.env).
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose
  -f docker-compose.yml
  -f docker-compose.testnet.yml
  -f docker-compose.gcp-testnet.yml
  -f docker-compose.provider.yml
  --profile provider)

echo "=== start provider-node ==="
"${COMPOSE[@]}" up -d provider-node
for i in $(seq 1 40); do
  st=$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' proxyhubb-provider-node 2>/dev/null || echo missing)
  echo "try=$i $st"
  echo "$st" | grep -qiE 'running|healthy' && break
  sleep 5
done
docker logs proxyhubb-provider-node --tail 40 2>&1 || true
echo PROVIDER_UP_DONE

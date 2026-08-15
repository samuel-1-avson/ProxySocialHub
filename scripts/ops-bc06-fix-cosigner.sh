#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

# Container runs as appuser — allow read of cosigner (not oracle/hot).
chmod 644 secrets/multisig-cosigner.json
chown root:root secrets/multisig-cosigner.json

"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api
for i in $(seq 1 36); do
  st=$("${COMPOSE[@]}" ps control-api --format '{{.Status}}' || true)
  echo "try=$i api=$st"
  echo "$st" | grep -qi healthy && break
  sleep 5
done

"${COMPOSE[@]}" exec -T control-api test -r /opt/proxyhubb/secrets/multisig-cosigner.json
echo COSIGNER_READABLE

sleep 2
"${COMPOSE[@]}" logs control-api --since 3m 2>/dev/null | grep -E 'Multi-Sig|multisig|cosigner' | tail -20 || true
curl -fsS -o /dev/null -w "health=%{http_code}\n" http://127.0.0.1:8080/health
echo BC06_COSIGNER_FIXED

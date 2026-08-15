#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
tr -d '\015' </tmp/bc06/main.go > services/control-api/main.go
# keep latest from /tmp if re-uploaded
if [[ -f /tmp/bc06-main.go ]]; then
  tr -d '\015' </tmp/bc06-main.go > services/control-api/main.go
fi
grep -q 'BC-06: multi-sig settle client' services/control-api/main.go
chmod 644 secrets/multisig-cosigner.json
"${COMPOSE[@]}" build --no-cache control-api
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api
for i in $(seq 1 60); do
  st=$("${COMPOSE[@]}" ps control-api --format '{{.Status}}' || true)
  echo "try=$i api=$st"
  echo "$st" | grep -qi healthy && break
  sleep 5
done
echo "$st" | grep -qi healthy
sleep 2
"${COMPOSE[@]}" logs control-api --since 3m 2>/dev/null | grep -E 'Multi-Sig Oracle initialized|Failed to init Multi-Sig|Failed to load multi-sig' | tail -10
curl -fsS -o /dev/null -w "health=%{http_code}\n" http://127.0.0.1:8080/health
echo BC06_REDEPLOY_MAIN_DONE

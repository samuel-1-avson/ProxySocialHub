#!/usr/bin/env bash
# After DB-01 journal backfill: enable journal drift critical alerts + recreate control-api.
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
if [[ -f docker-compose.redis-ha.yml ]]; then
  COMPOSE+=(-f docker-compose.redis-ha.yml)
fi

ENV_FILE=.env
touch "$ENV_FILE"
if grep -qE '^PROXYHUB_JOURNAL_DRIFT_ALERTS=' "$ENV_FILE"; then
  sed -i 's/^PROXYHUB_JOURNAL_DRIFT_ALERTS=.*/PROXYHUB_JOURNAL_DRIFT_ALERTS=1/' "$ENV_FILE"
else
  printf '\nPROXYHUB_JOURNAL_DRIFT_ALERTS=1\n' >>"$ENV_FILE"
fi
grep -E '^PROXYHUB_JOURNAL_DRIFT_ALERTS=' "$ENV_FILE" | sed 's/\r$//'

"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api
for i in $(seq 1 40); do
  st=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' proxyhubb-control-api-1 2>/dev/null || echo missing)
  echo "api_health try=$i status=$st"
  [[ "$st" == "healthy" ]] && break
  sleep 3
done
[[ "$st" == "healthy" ]] || { echo 'CONTROL_API_NOT_HEALTHY'; exit 1; }
echo "JOURNAL_DRIFT_ALERTS_ENABLED"

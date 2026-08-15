#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

SRC=/tmp/main.go
[[ -f "$SRC" ]] || { echo "missing $SRC"; exit 1; }
tr -d '\015' <"$SRC" > services/control-api/main.go
grep -q 'logging.Init()' services/control-api/main.go
echo LOGGING_INIT_SOURCE_OK

"${COMPOSE[@]}" build control-api
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api

for i in $(seq 1 48); do
  st=$("${COMPOSE[@]}" ps control-api --format '{{.Status}}' || true)
  echo "try=$i api=$st"
  echo "$st" | grep -qi healthy && break
  sleep 5
done
echo "$st" | grep -qi healthy

sleep 8
echo "=== logger + drift alerts ==="
"${COMPOSE[@]}" logs control-api --since 3m 2>/dev/null \
  | grep -iE 'Logger initialized|No alert channels|Alert channels|JOURNAL|PER-WALLET|Liability|WALLET RECONCILIATION|alert_title|NATS consumer lag' \
  | head -60 || true

echo "=== nats gauges still present ==="
curl -fsS http://127.0.0.1:8080/metrics \
  | grep -E '^nats_consumer_num_pending|^nats_lag_scrape' | head -10 || echo NONE

echo LOGGING_INIT_DEPLOY_DONE

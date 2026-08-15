#!/usr/bin/env bash
# Hotfix: expose default Prometheus registry on /metrics (NATS lag gauges).
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

SRC=/tmp/metrics.go
[[ -f "$SRC" ]] || { echo "missing $SRC"; exit 1; }
tr -d '\015' <"$SRC" > services/control-api/internal/monitoring/metrics.go
grep -q 'DefaultGatherer' services/control-api/internal/monitoring/metrics.go
echo METRICS_SOURCE_OK

echo "=== rebuild control-api ==="
"${COMPOSE[@]}" build control-api
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api

for i in $(seq 1 48); do
  st=$("${COMPOSE[@]}" ps control-api --format '{{.Status}}' || true)
  echo "try=$i api=$st"
  echo "$st" | grep -qi healthy && break
  sleep 5
done
echo "$st" | grep -qi healthy

echo "=== wait scraper tick ==="
sleep 35

echo "=== nats gauges ==="
curl -fsS http://127.0.0.1:8080/metrics \
  | grep -E '^nats_(consumer_num_pending|consumer_num_ack_pending|stream_messages|stream_bytes|lag_scrape_errors)' \
  | head -40 || echo NONE

echo "=== recon / drift log after restart ==="
"${COMPOSE[@]}" logs control-api --since 5m 2>/dev/null \
  | grep -iE 'NATS consumer lag|JOURNAL|PER-WALLET|Liability|Alert channels|No alert channels|reconciliation' \
  | tail -50 || true

echo METRICS_FIX_DEPLOY_DONE

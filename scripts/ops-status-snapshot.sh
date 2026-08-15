#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
echo "=== compose status ==="
"${COMPOSE[@]}" --profile observability ps --format 'table {{.Name}}\t{{.Status}}\t{{.Service}}' 2>/dev/null | head -40
echo "=== public config ==="
curl -fsS http://127.0.0.1:8080/v1/system/config/public | head -c 800; echo
echo "=== health nodes public ==="
curl -sS -o /dev/null -w "health_nodes=%{http_code}\n" http://127.0.0.1:8080/v1/health/nodes || true
echo "=== nats gauges ==="
curl -fsS http://127.0.0.1:8080/metrics 2>/dev/null | grep -E '^nats_consumer_num_pending|^nats_lag_scrape' | head -10 || true
echo "=== alert init ==="
"${COMPOSE[@]}" logs control-api --since 30m 2>/dev/null | grep -E 'Alert channels|No alert channels|Logger initialized' | tail -5 || true
echo SNAPSHOT_DONE

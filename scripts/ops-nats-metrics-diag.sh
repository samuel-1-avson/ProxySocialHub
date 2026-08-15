#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo "=== metrics nats lines ==="
curl -fsS http://127.0.0.1:8080/metrics | grep -i nats | head -40 || echo NONE

echo "=== control-api NATS env ==="
"${COMPOSE[@]}" exec -T control-api sh -c 'printenv' | grep -iE 'NATS|JETSTREAM' | tr -d '\r' || true

echo "=== nats / related containers ==="
"${COMPOSE[@]}" ps --format 'table {{.Name}}\t{{.Status}}\t{{.Service}}' | grep -iE 'nats|control|edge|redis' || true

echo "=== control-api boot NATS lines ==="
"${COMPOSE[@]}" logs control-api --since 30m 2>/dev/null | grep -iE 'nats|jetstream|JS |scraper' | head -50 || true

echo "=== edge health ==="
curl -sS -w "\nedge_health_http=%{http_code}\n" http://127.0.0.1:8090/health || true
curl -sS -w "\nedge_ready_http=%{http_code}\n" http://127.0.0.1:8090/ready || true
"${COMPOSE[@]}" logs edge-gateway --since 15m 2>/dev/null | tail -50 || true

echo "=== journal drift alert lines ==="
"${COMPOSE[@]}" logs control-api --since 30m 2>/dev/null \
  | grep -iE 'PER-WALLET DRIFT|Journal Per-Wallet|Journal Liability|TREASURY_DEFICIT|DEFICIT' | tail -30 || true

echo OPS_NATS_DIAG_DONE

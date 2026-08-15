#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo "=== schema_migrations near 128 ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT version, applied_at FROM schema_migrations WHERE version LIKE '%128%' OR version LIKE '%pricing%' OR version LIKE '%127%' ORDER BY version;"

echo "=== listing price stats ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT proxy_type, ROUND(AVG(price_per_gb)::numeric,4) AS avg_usd, ROUND(MIN(price_per_gb)::numeric,4) AS min_usd, ROUND(MAX(price_per_gb)::numeric,4) AS max_usd, COUNT(*) FROM proxy_listings WHERE status <> 'deleted' GROUP BY 1 ORDER BY 1;"

echo "=== migration file present ==="
ls -la migrations/000128* || true

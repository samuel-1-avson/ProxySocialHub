#!/usr/bin/env bash
# Inspect metering_wal_spill statuses (PowerShell-safe remote helper).
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT status, count(*) FROM metering_wal_spill GROUP BY 1 ORDER BY 1;"
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT id::text, status, left(session_username,28) AS sess, bytes_up, bytes_down, left(coalesce(error,''),80) AS err FROM metering_wal_spill ORDER BY created_at DESC LIMIT 8;"

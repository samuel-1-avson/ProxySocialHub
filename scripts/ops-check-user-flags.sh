#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
UID_S=b77e84c9-0e85-4f23-afc0-581cd561c216
echo "=== user_flags ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT * FROM user_flags WHERE user_id='$UID_S' ORDER BY created_at DESC LIMIT 10;" 2>/dev/null || \
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT column_name FROM information_schema.columns WHERE table_name='user_flags';"
echo "=== security_anomalies ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT * FROM security_anomalies WHERE user_id='$UID_S' ORDER BY created_at DESC LIMIT 5;" 2>/dev/null || \
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT column_name FROM information_schema.columns WHERE table_name='security_anomalies';"
echo FLAG_CHECK_DONE

#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
OID="${OID:-2c03d6dd-ee82-4457-a0a5-b88ac0b0c842}"
NODE="${NODE:-4b60f9e2-11dc-4240-a332-6ec9f3669379}"

psql() { "${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -v ON_ERROR_STOP=1 "$@"; }

echo "=== order/session ==="
psql -c "SELECT id, status, session_id, listing_id, seller_id FROM orders WHERE id='$OID';"
psql -c "SELECT id, status, node_id, provider_node_id, user_id, listing_id FROM sessions WHERE id=(SELECT session_id FROM orders WHERE id='$OID') OR order_id='$OID' ORDER BY created_at DESC LIMIT 5;" 2>/dev/null || \
psql -c "SELECT column_name FROM information_schema.columns WHERE table_name='sessions' ORDER BY ordinal_position;" 

echo "=== provider node ==="
psql -c "SELECT id, status, is_healthy, gateway_node_id, deleted_at IS NOT NULL AS deleted, last_seen_at FROM provider_nodes WHERE id='$NODE' OR gateway_node_id LIKE 'node_b77e%';"

echo "=== listing ==="
psql -c "SELECT id, status, provider_node_id FROM proxy_listings WHERE id='c1472dbc-dee3-407e-8fea-ec3ed42489ac';"

echo "=== provider tunnel logs ==="
docker logs proxyhubb-provider-node --tail 30 2>&1 | grep -iE 'tunnel|request|proxy|connect|error|stream' || docker logs proxyhubb-provider-node --tail 20 2>&1

echo "=== edge logs around CONNECT ==="
docker logs proxyhubb-edge-gateway-1 --since 10m 2>&1 | grep -iE 'session|proxy|connect|407|route|provider|no.?node|select|lease|8090|auth' | tail -60

echo "=== edge listening ports ==="
docker exec proxyhubb-edge-gateway-1 sh -c 'ss -lntp 2>/dev/null || netstat -lntp 2>/dev/null' | head -40 || true

echo DIAG_CONNECT_ROUTE_DONE

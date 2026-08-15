#!/bin/bash
set -euo pipefail
sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -c \
"SELECT id, user_id, name, status, gateway_node_id, last_seen_at
 FROM provider_nodes
 WHERE id = '0f2396c1-45a7-4cf1-a2a4-19e262bc0d51'
    OR gateway_node_id LIKE '%b77e84c9%'
    OR user_id::text = 'b77e84c9-0e85-4f23-afc0-581cd561c216'
 ORDER BY last_seen_at DESC NULLS LAST
 LIMIT 20;"

echo '--- users ---'
sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -c \
"SELECT id, email, created_at FROM users WHERE id = 'b77e84c9-0e85-4f23-afc0-581cd561c216' LIMIT 5;"

echo '--- all nodes for that user ---'
sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -c \
"SELECT id, name, status, gateway_node_id, last_seen_at FROM provider_nodes WHERE user_id = 'b77e84c9-0e85-4f23-afc0-581cd561c216';"

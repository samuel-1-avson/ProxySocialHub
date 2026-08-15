#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
DC=(sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
"${DC[@]}" ps redis 2>&1 | head -20
echo "---"
sudo docker ps --format '{{.Names}}' | grep -i redis
echo "---"
sudo docker exec proxyhubb-redis-1 redis-cli PING || sudo docker exec $($DC ps -q redis) redis-cli PING

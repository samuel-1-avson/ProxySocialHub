#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo '=== networks ==='
docker inspect proxyhubb-control-api-1 --format '{{json .NetworkSettings.Networks}}' | tr ',' '\n' | head -20
docker inspect proxyhubb-ipfs-1 --format '{{json .NetworkSettings.Networks}}' | tr ',' '\n' | head -20

echo '=== api id POST from control-api ==='
"${COMPOSE[@]}" exec -T control-api sh -c 'wget -qO- --post-data="" --timeout=10 http://ipfs:5001/api/v0/id' | head -c 200
echo

echo '=== multipart add from control-api ==='
ADD=$("${COMPOSE[@]}" exec -T control-api sh -c '
  B=----phb
  {
    printf -- "--%s\r\n" "$B"
    printf "Content-Disposition: form-data; name=\"file\"; filename=\"content.txt\"\r\n"
    printf "Content-Type: application/octet-stream\r\n\r\n"
    printf "proxyhubb-from-control-api"
    printf "\r\n--%s--\r\n" "$B"
  } > /tmp/ipfs-mp.txt
  wget -qO- --header="Content-Type: multipart/form-data; boundary=$B" \
    --post-file=/tmp/ipfs-mp.txt \
    http://ipfs:5001/api/v0/add
')
echo "$ADD"
echo IPFS_REACHABILITY_DONE

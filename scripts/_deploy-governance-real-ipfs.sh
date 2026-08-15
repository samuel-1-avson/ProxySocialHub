#!/usr/bin/env bash
# Wire real IPFS (Kubo) for governance on gcp-testnet; disable stub.
# Pinata still preferred when PINATA_JWT is present in .env.
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

if [[ -f /tmp/docker-compose.gcp-testnet.yml ]]; then
  sed -i 's/\r$//' /tmp/docker-compose.gcp-testnet.yml
  cp -f /tmp/docker-compose.gcp-testnet.yml docker-compose.gcp-testnet.yml
fi

upsert_env() {
  local key="$1" val="$2"
  if grep -q "^${key}=" .env 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" .env
  else
    echo "${key}=${val}" >> .env
  fi
}

upsert_env GOVERNANCE_IPFS_STUB 0
upsert_env IPFS_NODE_URL 'http://ipfs:5001'
upsert_env IPFS_GATEWAY 'http://ipfs:8080/ipfs/'

grep -E '^(GOVERNANCE_IPFS_STUB|IPFS_NODE_URL|IPFS_GATEWAY)=' .env | sed 's/\r$//'
if grep -q '^PINATA_JWT=.\+' .env 2>/dev/null; then
  echo 'PINATA_JWT=set'
else
  echo 'PINATA_JWT=unset (using Kubo)'
fi

"${COMPOSE[@]}" pull ipfs
# Recreate so network attachment (backend) is applied.
"${COMPOSE[@]}" up -d --force-recreate ipfs
for i in $(seq 1 40); do
  st=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' proxyhubb-ipfs-1 2>/dev/null || echo missing)
  echo "ipfs try=$i health=$st"
  [[ "$st" == "healthy" ]] && break
  sleep 3
done
[[ "$st" == "healthy" ]] || { echo 'IPFS_NOT_HEALTHY'; exit 1; }

# Confirm shared network with control-api
IPFS_NET=$(docker inspect proxyhubb-ipfs-1 --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}')
echo "ipfs_networks=$IPFS_NET"
echo "$IPFS_NET" | grep -q backend || { echo 'IPFS_NOT_ON_BACKEND_NETWORK'; exit 1; }

"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api
for i in $(seq 1 40); do
  st=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' proxyhubb-control-api-1 2>/dev/null || echo missing)
  echo "api try=$i health=$st"
  [[ "$st" == "healthy" ]] && break
  sleep 3
done
[[ "$st" == "healthy" ]] || { echo 'CONTROL_API_NOT_HEALTHY'; exit 1; }

echo '=== container env (masked) ==='
"${COMPOSE[@]}" exec -T control-api sh -c 'printf "GOVERNANCE_IPFS_STUB=%s\nIPFS_NODE_URL=%s\nIPFS_GATEWAY=%s\nPINATA_JWT=%s\n" \
  "$GOVERNANCE_IPFS_STUB" "$IPFS_NODE_URL" "$IPFS_GATEWAY" \
  "$( [ -n "${PINATA_JWT:-}" ] && echo set || echo unset )"'

echo '=== Kubo add via control-api (same path as governance) ==='
# Kubo HTTP API requires POST (GET returns empty / fails).
API_OK=$("${COMPOSE[@]}" exec -T control-api sh -c 'wget -qO- --post-data="" --timeout=10 http://ipfs:5001/api/v0/id' | head -c 120 || true)
echo "api_id_prefix=${API_OK}"
[[ -n "$API_OK" ]] || { echo 'IPFS_API_UNREACHABLE_FROM_CONTROL_API'; exit 1; }

ADD_JSON=$("${COMPOSE[@]}" exec -T control-api sh -c '
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
' | tr -d '\r')
echo "add_json_from_control_api=$ADD_JSON"
echo "$ADD_JSON" | grep -q '"Hash"' || { echo 'CONTROL_API_ADD_FAILED'; exit 1; }
echo "$ADD_JSON" | grep -q 'bafye2e' && { echo 'STUB_CID_UNEXPECTED'; exit 1; }
CID=$(echo "$ADD_JSON" | sed -n 's/.*"Hash":"\([^"]*\)".*/\1/p')
echo "cid=$CID"
BODY=$("${COMPOSE[@]}" exec -T ipfs ipfs cat "$CID" | tr -d '\r')
echo "cat_body=$BODY"
[[ "$BODY" == *proxyhubb-from-control-api* ]] || { echo 'IPFS_CAT_FAILED'; exit 1; }

echo GOVERNANCE_REAL_IPFS_DONE

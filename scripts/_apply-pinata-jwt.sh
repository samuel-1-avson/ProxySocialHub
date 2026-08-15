#!/usr/bin/env bash
# Apply PINATA_JWT from a file (never echo the secret).
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

JWT_FILE="${1:-/tmp/pinata.jwt}"
[[ -f "$JWT_FILE" ]] || { echo "missing $JWT_FILE"; exit 1; }
JWT=$(tr -d '\r\n ' < "$JWT_FILE")
[[ -n "$JWT" ]] || { echo "empty jwt"; exit 1; }

# Auth check before writing .env
AUTH=$(curl -sS -H "Authorization: Bearer ${JWT}" \
  -H "accept: application/json" \
  https://api.pinata.cloud/data/testAuthentication || true)
echo "pinata_auth=$AUTH"
echo "$AUTH" | grep -qi Congratulations || { echo 'PINATA_AUTH_FAILED'; exit 1; }

umask 077
if grep -q '^PINATA_JWT=' .env 2>/dev/null; then
  # Replace line without printing value
  awk -v jwt="$JWT" 'BEGIN{done=0} /^PINATA_JWT=/{print "PINATA_JWT=" jwt; done=1; next} {print} END{if(!done) print "PINATA_JWT=" jwt}' .env > .env.tmp
  mv .env.tmp .env
else
  printf '\nPINATA_JWT=%s\n' "$JWT" >> .env
fi

# Prefer Pinata; keep Kubo as fallback path if JWT unset later
if grep -q '^GOVERNANCE_IPFS_STUB=' .env; then
  sed -i 's/^GOVERNANCE_IPFS_STUB=.*/GOVERNANCE_IPFS_STUB=0/' .env
else
  echo 'GOVERNANCE_IPFS_STUB=0' >> .env
fi

chmod 600 .env
shred -u "$JWT_FILE" 2>/dev/null || rm -f "$JWT_FILE"

"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api
for i in $(seq 1 40); do
  st=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' proxyhubb-control-api-1 2>/dev/null || echo missing)
  echo "try=$i health=$st"
  [[ "$st" == "healthy" ]] && break
  sleep 3
done

"${COMPOSE[@]}" exec -T control-api sh -c 'printf "PINATA_JWT=%s\nGOVERNANCE_IPFS_STUB=%s\n" "$( [ -n "$PINATA_JWT" ] && echo set || echo unset )" "$GOVERNANCE_IPFS_STUB"'

# Pin smoke via Pinata from control-api network
SMOKE=$("${COMPOSE[@]}" exec -T control-api sh -c '
  B=----phb
  {
    printf -- "--%s\r\n" "$B"
    printf "Content-Disposition: form-data; name=\"file\"; filename=\"content.txt\"\r\n"
    printf "Content-Type: application/octet-stream\r\n\r\n"
    printf "proxyhubb-pinata-smoke"
    printf "\r\n--%s--\r\n" "$B"
  } > /tmp/pinata-mp.txt
  wget -qO- --header="Authorization: Bearer $PINATA_JWT" \
    --header="Content-Type: multipart/form-data; boundary=$B" \
    --post-file=/tmp/pinata-mp.txt \
    https://api.pinata.cloud/pinning/pinFileToIPFS
' | tr -d '\r')
echo "pin_smoke=${SMOKE:0:120}"
echo "$SMOKE" | grep -q IpfsHash || { echo 'PINATA_PIN_FAILED'; exit 1; }
echo "$SMOKE" | grep -q bafye2e && { echo 'STUB_CID_UNEXPECTED'; exit 1; }

echo PINATA_JWT_APPLIED

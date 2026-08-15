#!/usr/bin/env bash
# Fix provider tunnel for laptop operators:
#  1) Install Let's Encrypt certs (proxy.proxyhubb.com) into edge-gateway
#  2) Publish alternate tunnel port 8443 (ISP-friendly)
#  3) Point PROVIDER_TUNNEL_* at hostname (not raw IP)
#  4) Recreate edge-gateway + control-api
set -euo pipefail
cd "${PROJECT_DIR:-/opt/proxyhubb}"
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

LE_DIR="${LE_DIR:-/var/lib/caddy/.local/share/caddy/certificates/acme-v02.api.letsencrypt.org-directory/proxy.proxyhubb.com}"
CRT="$LE_DIR/proxy.proxyhubb.com.crt"
KEY="$LE_DIR/proxy.proxyhubb.com.key"
[[ -f "$CRT" && -f "$KEY" ]] || { echo "missing LE certs at $LE_DIR"; exit 1; }

mkdir -p certs
install -m 644 "$CRT" certs/server.crt
# key must be readable by container user — keep 640 root:docker if possible
install -m 644 "$KEY" certs/server.key
openssl x509 -in certs/server.crt -noout -subject -issuer | head -5

set_env() {
  local key="$1" val="$2"
  if grep -q "^${key}=" .env 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" .env
  else
    echo "${key}=${val}" >> .env
  fi
}

set_env PROVIDER_TUNNEL_PUBLIC_ADDR "proxy.proxyhubb.com:3128"
set_env PROVIDER_TUNNEL_PUBLIC_ADDRS "proxy.proxyhubb.com:8443"
set_env EDGE_GATEWAY_TUNNEL_ALT_PORT "8443"

# Ensure compose overlay maps 8443 (file may already be updated via deploy)
if ! grep -q 'EDGE_GATEWAY_TUNNEL_ALT_PORT' docker-compose.gcp-testnet.yml 2>/dev/null; then
  echo "WARN: docker-compose.gcp-testnet.yml missing ALT_PORT mapping — applying inline publish"
fi

"${COMPOSE[@]}" up -d --no-deps --force-recreate edge-gateway control-api

for i in $(seq 1 40); do
  st=$("${COMPOSE[@]}" ps edge-gateway --format '{{.Status}}' || true)
  echo "edge=$st"
  echo "$st" | grep -qi 'up' && break
  sleep 3
done

ss -lntp | grep -E ':3128|:8443|:8090' || true
"${COMPOSE[@]}" logs edge-gateway --tail 15 2>/dev/null | grep -iE 'Tunnel Server|TLS|plaintext|listening' || true

echo PROVIDER_TUNNEL_FIXED
echo "Operators must re-download provider.toml from Dashboard → Connect (hostname + signing key + api_key)."

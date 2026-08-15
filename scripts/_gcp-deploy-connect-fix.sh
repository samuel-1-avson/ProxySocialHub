#!/usr/bin/env bash
# Deploy control-api connect-info fix (tunnel addrs / TLS flags) to GCP.
set -euo pipefail
PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
SRC="${1:?path to provider_nodes.go}"
cd "$PROJECT_DIR"
install -m 644 "$SRC" services/control-api/internal/api/provider_nodes.go
tr -d '\015' < services/control-api/internal/api/provider_nodes.go > /tmp/pn.go
mv /tmp/pn.go services/control-api/internal/api/provider_nodes.go
grep -q 'providerPublicTunnelAddrs' services/control-api/internal/api/provider_nodes.go
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
# Ensure tunnel env
set_env() {
  local key="$1" val="$2"
  if grep -q "^${key}=" .env 2>/dev/null; then sed -i "s|^${key}=.*|${key}=${val}|" .env
  else echo "${key}=${val}" >> .env; fi
}
set_env PROVIDER_TUNNEL_PUBLIC_ADDR "proxy.proxyhubb.com:3128"
set_env PROVIDER_TUNNEL_PUBLIC_ADDRS "proxy.proxyhubb.com:8443"
"${COMPOSE[@]}" build control-api
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api
for i in $(seq 1 40); do
  st=$("${COMPOSE[@]}" ps control-api --format '{{.Status}}' || true)
  echo "$st" | grep -qi healthy && break
  sleep 3
done
echo CONTROL_API_CONNECT_FIX_DONE

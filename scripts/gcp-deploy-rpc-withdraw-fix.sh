#!/usr/bin/env bash
set -euo pipefail
PROJECT_DIR=/opt/proxyhubb
DEPLOY_TAR="${DEPLOY_TAR:?}"
DOCKER=docker
cd "$PROJECT_DIR"
tmpdir=$(mktemp -d)
tar -xzf "$DEPLOY_TAR" -C "$tmpdir"
cp -a "$tmpdir/control-api/." "$PROJECT_DIR/services/control-api/"
rm -rf "$tmpdir"
find "$PROJECT_DIR/services/control-api" -name '*.go' -exec sed -i 's/\r$//' {} +
grep -q 'healthy-first' "$PROJECT_DIR/services/control-api/internal/solana/rpc_endpoint.go"
grep -q 'balanceCacheTTL' "$PROJECT_DIR/services/control-api/internal/solana/client.go"
COMPOSE=($DOCKER compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
"${COMPOSE[@]}" build control-api
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api
for i in $(seq 1 48); do
  st=$("${COMPOSE[@]}" ps control-api --format '{{.Status}}' || true)
  echo "try=$i $st"
  echo "$st" | grep -qi healthy && break
  sleep 5
done
echo "$st" | grep -qi healthy
sleep 2
sudo docker logs proxyhubb-control-api-1 2>&1 | grep -E 'rpc_endpoints=|rpc\[' | tail -n 10
curl -sS http://127.0.0.1:18080/v1/treasury/public | head -c 500; echo
echo DONE

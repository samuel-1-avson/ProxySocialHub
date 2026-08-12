#!/usr/bin/env bash
# Deploy apps/docs to the GCE VM (build locally on VM).
#
# Usage (on proxyhubb-testnet):
#   ./scripts/gcp-deploy-docs.sh
#
# Requires: docs.proxyhubb.com DNS + Caddy reverse_proxy to 127.0.0.1:3010
# (see config/gcp/Caddyfile.example).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="${PROJECT_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
DOCKER="${DOCKER:-docker}"

cd "$PROJECT_DIR"

# Keep published OpenAPI in sync with the authoritative contract before image build.
bash "$SCRIPT_DIR/sync-docs-openapi.sh"

# Ensure docs healthcheck probes /docs (not bare /).
if [[ -f "$PROJECT_DIR/docker-compose.yml" ]]; then
  sed -i 's|http://127.0.0.1:3000/"|http://127.0.0.1:3000/docs"|g' "$PROJECT_DIR/docker-compose.yml" || true
fi

COMPOSE=(
  "$DOCKER" compose
  -f "$PROJECT_DIR/docker-compose.yml"
  -f "$PROJECT_DIR/docker-compose.testnet.yml"
  -f "$PROJECT_DIR/docker-compose.gcp-testnet.yml"
)

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Building docs…"
"${COMPOSE[@]}" build docs
"${COMPOSE[@]}" up -d --no-deps --force-recreate docs

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Waiting for docs healthy…"
for i in $(seq 1 60); do
  st=$("${COMPOSE[@]}" ps docs --format '{{.Status}}' 2>/dev/null || true)
  echo "try=$i $st"
  if echo "$st" | grep -qi healthy; then
    echo HEALTHY
    break
  fi
  sleep 5
done

code=$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:3010/docs" || echo fail)
echo "local_/docs=$code"
"${COMPOSE[@]}" ps docs
echo DOCS_DEPLOY_DONE

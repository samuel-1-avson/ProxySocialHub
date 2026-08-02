#!/usr/bin/env bash
# Deploy HB-05: edge register await + readiness tunnel_ready + fast UI poll.
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
DEPLOY_TAR="${DEPLOY_TAR:?Set DEPLOY_TAR}"
DOCKER="${DOCKER:-docker}"

cd "$PROJECT_DIR"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Extracting $DEPLOY_TAR"
tmpdir=$(mktemp -d)
tar -xzf "$DEPLOY_TAR" -C "$tmpdir"

if [[ -d "$tmpdir/control-api" ]]; then
  mkdir -p "$PROJECT_DIR/services/control-api"
  cp -a "$tmpdir/control-api/." "$PROJECT_DIR/services/control-api/"
fi
if [[ -d "$tmpdir/edge-gateway" ]]; then
  mkdir -p "$PROJECT_DIR/services/edge-gateway"
  cp -a "$tmpdir/edge-gateway/." "$PROJECT_DIR/services/edge-gateway/"
fi
if [[ -d "$tmpdir/web" ]]; then
  mkdir -p "$PROJECT_DIR/apps/web"
  cp -a "$tmpdir/web/." "$PROJECT_DIR/apps/web/"
fi
rm -rf "$tmpdir"

find "$PROJECT_DIR/services/control-api" "$PROJECT_DIR/services/edge-gateway" "$PROJECT_DIR/apps/web" \
  -type f \( -name '*.go' -o -name '*.rs' -o -name '*.tsx' -o -name '*.ts' \) \
  -exec sed -i 's/\r$//' {} + 2>/dev/null || true

grep -q 'tunnel_ready' "$PROJECT_DIR/services/control-api/internal/api/provider_readiness.go"
grep -q 'edge_tunnel' "$PROJECT_DIR/services/control-api/internal/api/provider_readiness.go"
grep -q 'Control API register timed out after 3s' "$PROJECT_DIR/services/edge-gateway/src/tunnel.rs"
grep -q 'tunnel_ready' "$PROJECT_DIR/apps/web/src/lib/api/provider.ts"
grep -q 'HB-05' "$PROJECT_DIR/apps/web/src/app/dashboard/provider/page.tsx"

COMPOSE=(
  "$DOCKER" compose
  -f "$PROJECT_DIR/docker-compose.yml"
  -f "$PROJECT_DIR/docker-compose.testnet.yml"
  -f "$PROJECT_DIR/docker-compose.gcp-testnet.yml"
)

cd "$PROJECT_DIR"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Building control-api edge-gateway web"
"${COMPOSE[@]}" build control-api edge-gateway web

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Recreating services"
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api edge-gateway web

for svc in control-api edge-gateway web; do
  ok=0
  for i in $(seq 1 90); do
    st=$("${COMPOSE[@]}" ps "$svc" --format '{{.Status}}' 2>/dev/null || true)
    echo "try=$i $svc $st"
    if echo "$st" | grep -qi healthy; then
      echo "$svc HEALTHY"
      ok=1
      break
    fi
    # edge-gateway may report "Up" without healthcheck label on some compose files
    if [[ "$svc" == "edge-gateway" ]] && echo "$st" | grep -qiE 'Up [0-9]'; then
      if ! echo "$st" | grep -qi '(health: starting)'; then
        echo "$svc UP"
        ok=1
        break
      fi
    fi
    sleep 5
  done
  if [[ "$ok" != "1" ]]; then
    echo "$svc failed healthy" >&2
    "${COMPOSE[@]}" logs --tail=80 "$svc" || true
    exit 1
  fi
done

curl -sS -o /dev/null -w "api_health=%{http_code}\n" http://127.0.0.1:8080/health || true
curl -sS -o /dev/null -w "web_health=%{http_code}\n" http://127.0.0.1:3000/ || true
echo "HB05_DEPLOY_DONE"

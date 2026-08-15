#!/usr/bin/env bash
# Deploy session P1: sticky rebind, JWT rotation honor, intent mint cap, expire worker.
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
rm -rf "$tmpdir"

find "$PROJECT_DIR/services/control-api" "$PROJECT_DIR/services/edge-gateway" \
  -type f \( -name '*.go' -o -name '*.rs' \) \
  -exec sed -i 's/\r$//' {} + 2>/dev/null || true

grep -q 'countOpenSessionIntents' "$PROJECT_DIR/services/control-api/internal/api/session.go"
grep -q 'StartSessionIntentExpireWorker' "$PROJECT_DIR/services/control-api/internal/worker/worker.go"
grep -q 'expireStaleSessionIntents' "$PROJECT_DIR/services/control-api/internal/worker/session_intent_expire.go"
grep -q 'config_from_session_claims' "$PROJECT_DIR/services/edge-gateway/src/rotation.rs"
grep -q 'sticky session bound/rebound' "$PROJECT_DIR/services/edge-gateway/src/registry/provider_selection.rs"
grep -q 'rotation_interval_seconds' "$PROJECT_DIR/services/edge-gateway/src/registry/provider_selection.rs"

COMPOSE=(
  "$DOCKER" compose
  -f "$PROJECT_DIR/docker-compose.yml"
  -f "$PROJECT_DIR/docker-compose.testnet.yml"
  -f "$PROJECT_DIR/docker-compose.gcp-testnet.yml"
)

cd "$PROJECT_DIR"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Building control-api + edge-gateway"
"${COMPOSE[@]}" build control-api edge-gateway

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Recreating control-api + edge-gateway"
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api edge-gateway

for svc in control-api edge-gateway; do
  ok=0
  for i in $(seq 1 120); do
    st=$("${COMPOSE[@]}" ps "$svc" --format '{{.Status}}' 2>/dev/null || true)
    echo "try=$i $svc $st"
    if echo "$st" | grep -qi healthy; then
      echo "$svc HEALTHY"
      ok=1
      break
    fi
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
    "${COMPOSE[@]}" logs --tail=100 "$svc" || true
    exit 1
  fi
done

echo "=== verify ==="
curl -sS -o /dev/null -w "api_health=%{http_code}\n" http://127.0.0.1:8080/health || true
grep -n 'countOpenSessionIntents' "$PROJECT_DIR/services/control-api/internal/api/session.go" | head -2
grep -n 'config_from_session_claims' "$PROJECT_DIR/services/edge-gateway/src/rotation.rs" | head -2
grep -n 'sticky session bound/rebound' "$PROJECT_DIR/services/edge-gateway/src/registry/provider_selection.rs" | head -2
sudo docker logs proxyhubb-control-api-1 2>&1 | grep -E 'Session Intent Expire|SessionIntentExpire' | tail -5 || true
echo "SESSION_P1_DEPLOY_DONE"

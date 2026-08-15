#!/usr/bin/env bash
# Wave 2.1 — deploy J2 multipod overlay + control-api reaper to proxyhubb-testnet.
# Expect: run on VM after tar extract, or: bash /tmp/gcp-deploy-j2-multipod.sh
set -euo pipefail
PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
DEPLOY_TAR="${DEPLOY_TAR:-}"
cd "$PROJECT_DIR"

if [[ -n "$DEPLOY_TAR" && -f "$DEPLOY_TAR" ]]; then
  tmpdir=$(mktemp -d)
  tar -xzf "$DEPLOY_TAR" -C "$tmpdir"
  [[ -f "$tmpdir/docker-compose.j2-multipod.yml" ]] && cp -a "$tmpdir/docker-compose.j2-multipod.yml" "$PROJECT_DIR/"
  [[ -d "$tmpdir/scripts" ]] && cp -a "$tmpdir/scripts/." "$PROJECT_DIR/scripts/"
  [[ -d "$tmpdir/docs" ]] && mkdir -p "$PROJECT_DIR/docs" && cp -a "$tmpdir/docs/." "$PROJECT_DIR/docs/"
  [[ -d "$tmpdir/config" ]] && mkdir -p "$PROJECT_DIR/config" && cp -a "$tmpdir/config/." "$PROJECT_DIR/config/"
  [[ -d "$tmpdir/control-api" ]] && cp -a "$tmpdir/control-api/." "$PROJECT_DIR/services/control-api/"
  if [[ -d "$tmpdir/edge-gateway/src" ]]; then
    mkdir -p "$PROJECT_DIR/services/edge-gateway/src"
    cp -a "$tmpdir/edge-gateway/src/." "$PROJECT_DIR/services/edge-gateway/src/"
  elif [[ -d "$tmpdir/edge-gateway" ]]; then
    cp -a "$tmpdir/edge-gateway/." "$PROJECT_DIR/services/edge-gateway/"
  fi
  rm -rf "$tmpdir"
fi

strip_cr() { local f="$1" t; t=$(mktemp); tr -d '\015' < "$f" > "$t" && mv "$t" "$f"; }
strip_cr "$PROJECT_DIR/docker-compose.j2-multipod.yml"
strip_cr "$PROJECT_DIR/scripts/gcp-smoke-sprint-j2-multipod.sh"
find "$PROJECT_DIR/services/control-api/internal/sessioncache" -name '*.go' -print0 2>/dev/null \
  | while IFS= read -r -d '' f; do strip_cr "$f"; done
find "$PROJECT_DIR/services/control-api/internal/worker" -name 'session_gateway_cache_reaper.go' -o -name 'worker.go' -print0 2>/dev/null \
  | while IFS= read -r -d '' f; do strip_cr "$f"; done
find "$PROJECT_DIR/services/edge-gateway/src" -type f \( -name '*.rs' \) -print0 2>/dev/null \
  | while IFS= read -r -d '' f; do strip_cr "$f"; done
chmod +x "$PROJECT_DIR/scripts/gcp-smoke-sprint-j2-multipod.sh" \
  "$PROJECT_DIR/scripts/gcp-deploy-j2-multipod.sh" 2>/dev/null || true

grep -q 'edge-gateway-a' "$PROJECT_DIR/docker-compose.j2-multipod.yml"
grep -q 'SessionGatewayCacheReaper' "$PROJECT_DIR/services/control-api/internal/worker/worker.go"
grep -q 'SessionEscrowRequired' "$PROJECT_DIR/services/edge-gateway/src/error.rs"
echo SOURCES_OK

COMPOSE=(docker compose
  -f docker-compose.yml
  -f docker-compose.testnet.yml
  -f docker-compose.gcp-testnet.yml
  -f docker-compose.j2-multipod.yml)

echo "=== build images first (keep live edge up until images ready) ==="
"${COMPOSE[@]}" build control-api edge-gateway-a edge-gateway-b

echo "=== cut over: stop single-process edge, start multipod ==="
docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml \
  stop edge-gateway 2>/dev/null || true
docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml \
  rm -f edge-gateway 2>/dev/null || true

"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api edge-gateway-a edge-gateway-b

for i in $(seq 1 72); do
  st_api=$("${COMPOSE[@]}" ps control-api --format '{{.Status}}' || true)
  st_a=$("${COMPOSE[@]}" ps edge-gateway-a --format '{{.Status}}' || true)
  st_b=$("${COMPOSE[@]}" ps edge-gateway-b --format '{{.Status}}' || true)
  echo "try=$i api=$st_api a=$st_a b=$st_b"
  echo "$st_api" | grep -qi healthy && echo "$st_a" | grep -Eqi 'healthy|Up' && echo "$st_b" | grep -Eqi 'healthy|Up' && break
  sleep 5
done
echo "$st_api" | grep -qi healthy
echo "$st_a" | grep -Eqi 'healthy|Up'
echo "$st_b" | grep -Eqi 'healthy|Up'

echo "=== J2 smoke ==="
bash "$PROJECT_DIR/scripts/gcp-smoke-sprint-j2-multipod.sh"

echo J2_MULTIPOD_DEPLOY_DONE

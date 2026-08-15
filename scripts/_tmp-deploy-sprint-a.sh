#!/usr/bin/env bash
# Sprint A deploy: sync FE/API honesty+WS fixes and rebuild web + control-api on the VM.
set -euo pipefail
TAR="${1:-/tmp/sprint-a-trust.tar.gz}"
ROOT="${ROOT:-/opt/proxyhubb}"
cd "$ROOT"

tar -xzf "$TAR" -C "$ROOT"
find "$ROOT/apps/web/src" "$ROOT/services/control-api/internal/api" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.go' \) \
  -exec sed -i 's/\r$//' {} + 2>/dev/null || true

# Ensure WS build arg points at API host (baked into Next client bundle)
export WS_PUBLIC_URL="${WS_PUBLIC_URL:-wss://api.proxyhubb.com}"
export NEXT_PUBLIC_WS_URL="${NEXT_PUBLIC_WS_URL:-$WS_PUBLIC_URL}"

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo "Building control-api..."
"${COMPOSE[@]}" build control-api
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api

echo "Building web with NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL ..."
# Compose build args for web — pass via environment if compose supports it
ALLOW_EMERGENCY_WEB_BUILD=1 \
  WS_PUBLIC_URL="$WS_PUBLIC_URL" \
  NEXT_PUBLIC_WS_URL="$NEXT_PUBLIC_WS_URL" \
  "${COMPOSE[@]}" build \
    --build-arg "NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL" \
    web
"${COMPOSE[@]}" up -d --no-deps --force-recreate web

for i in $(seq 1 40); do
  st=$("${COMPOSE[@]}" ps web --format '{{.Status}}' 2>/dev/null || true)
  echo "web try=$i $st"
  if echo "$st" | grep -qi healthy; then
    echo WEB_HEALTHY
    break
  fi
  sleep 5
done

for i in $(seq 1 30); do
  st=$("${COMPOSE[@]}" ps control-api --format '{{.Status}}' 2>/dev/null || true)
  echo "api try=$i $st"
  if echo "$st" | grep -qi healthy; then
    echo API_HEALTHY
    break
  fi
  sleep 3
done

echo "DONE sprint-a deploy"

#!/usr/bin/env bash
# Deploy audit hardening (control-api + edge-gateway) to proxyhubb-testnet.
# Usage on VM:
#   DEPLOY_TAR=/tmp/audit-hardening-....tar.gz bash /tmp/gcp-deploy-audit-hardening.sh
set -euo pipefail
PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
DEPLOY_TAR="${DEPLOY_TAR:?}"
cd "$PROJECT_DIR"

tmpdir=$(mktemp -d)
tar -xzf "$DEPLOY_TAR" -C "$tmpdir"

[[ -d "$tmpdir/control-api" ]] && cp -a "$tmpdir/control-api/." "$PROJECT_DIR/services/control-api/"
[[ -d "$tmpdir/edge-gateway" ]] && cp -a "$tmpdir/edge-gateway/." "$PROJECT_DIR/services/edge-gateway/"
mkdir -p "$PROJECT_DIR/scripts"
[[ -d "$tmpdir/scripts" ]] && cp -a "$tmpdir/scripts/." "$PROJECT_DIR/scripts/"
rm -rf "$tmpdir"

strip_cr() { local f="$1" t; t=$(mktemp); tr -d '\015' < "$f" > "$t" && mv "$t" "$f"; }
find "$PROJECT_DIR/services/control-api" -type f -name '*.go' -print0 2>/dev/null \
  | while IFS= read -r -d '' f; do strip_cr "$f"; done
find "$PROJECT_DIR/services/edge-gateway" -type f -name '*.rs' -print0 2>/dev/null \
  | while IFS= read -r -d '' f; do strip_cr "$f"; done
find "$PROJECT_DIR/scripts" -type f -name '*.sh' -print0 2>/dev/null \
  | while IFS= read -r -d '' f; do strip_cr "$f"; done
chmod +x "$PROJECT_DIR/scripts/"*.sh 2>/dev/null || true

# Source gates
grep -q 'ConfigureTrustedProxies' "$PROJECT_DIR/services/control-api/main.go"
grep -q 'RegisterAdminNodeHealthRoutes' "$PROJECT_DIR/services/control-api/main.go"
grep -q 'canAccessSessionUsage' "$PROJECT_DIR/services/control-api/internal/api/usage.go"
grep -q 'EnqueueEscrowSettle' "$PROJECT_DIR/services/control-api/internal/api/compensation_outbox.go"
grep -q 'StartConsumerLagScraper' "$PROJECT_DIR/services/control-api/main.go"
grep -q 'fail-open' "$PROJECT_DIR/services/edge-gateway/src/main.rs"
grep -q 'hydrate_and_rewarm' "$PROJECT_DIR/services/edge-gateway/src/auth.rs"
echo SOURCES_OK

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo "=== build control-api + edge-gateway ==="
"${COMPOSE[@]}" build control-api edge-gateway

echo "=== recreate ==="
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api edge-gateway

for i in $(seq 1 72); do
  st_api=$("${COMPOSE[@]}" ps control-api --format '{{.Status}}' || true)
  st_eg=$("${COMPOSE[@]}" ps edge-gateway --format '{{.Status}}' || true)
  echo "try=$i api=$st_api eg=$st_eg"
  echo "$st_api" | grep -qi healthy && echo "$st_eg" | grep -Eqi 'healthy|Up' && break
  sleep 5
done
echo "$st_api" | grep -qi healthy

echo "=== smoke ==="
curl -fsS -o /dev/null -w "health=%{http_code}\n" http://127.0.0.1:8080/health
# SEC-R1: public node inventory must not be available
code=$(curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:8080/v1/health/nodes || true)
echo "health_nodes_http=$code"
[[ "$code" == "404" || "$code" == "401" || "$code" == "403" ]] || {
  echo "FAIL: /v1/health/nodes still exposed (got $code)" >&2
  exit 1
}
curl -fsS http://127.0.0.1:8080/v1/health/system | head -c 200; echo
curl -fsS http://127.0.0.1:8080/v1/system/config/public | head -c 400; echo

echo "=== metrics sample (NATS lag gauges if present) ==="
curl -fsS http://127.0.0.1:8080/metrics 2>/dev/null | grep -E '^nats_consumer_num_pending|^nats_stream_messages' | head -20 || echo "(no nats_* gauges yet — scraper may need a tick)"

echo "=== chaos script present ==="
[[ -x "$PROJECT_DIR/scripts/chaos-redis-ha-lite.sh" ]] && echo chaos_script=OK

echo AUDIT_HARDENING_DEPLOY_DONE

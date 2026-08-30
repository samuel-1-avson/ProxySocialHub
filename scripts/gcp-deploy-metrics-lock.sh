#!/usr/bin/env bash
# D.1 — lock public /metrics on Host-A. Caddy 404 + control-api RequireMetricsAccess.
# Never --remove-orphans. Never recreate edge-a. Never slash gates.
#
# Upload payload to /tmp/metrics-lock/ then:
#   CONFIRM_METRICS_LOCK=1 bash /tmp/gcp-deploy-metrics-lock.sh
set -euo pipefail
ROOT="${PROJECT_DIR:-/opt/proxyhubb}"
CTR=proxyhubb-control-api-1
EDGE_A=proxyhubb-edge-gateway-a-1
STAMP="${ROLL_STAMP:-$(date -u +%Y%m%d-%H%M)}"
TAG="proxyhubb-control-api:pre-metrics-lock-${STAMP}"
SRC="${METRICS_LOCK_SRC:-/tmp/metrics-lock}"
CADDY="${CADDYFILE:-/etc/caddy/Caddyfile}"

cd "$ROOT"

API_COMPOSE=(
  -f docker-compose.yml
  -f docker-compose.testnet.yml
  -f docker-compose.gcp-testnet.yml
)
[[ -f docker-compose.w6-host-a-private.yml ]] && API_COMPOSE+=( -f docker-compose.w6-host-a-private.yml )
[[ -f docker-compose.w10-observe.yml ]] && API_COMPOSE+=( -f docker-compose.w10-observe.yml )
[[ -f docker-compose.w10-listing-observe.yml ]] && API_COMPOSE+=( -f docker-compose.w10-listing-observe.yml )
[[ -f docker-compose.w11-enforce.yml ]] && API_COMPOSE+=( -f docker-compose.w11-enforce.yml )

echo "=== D.1 metrics lock ==="
echo "root=$ROOT stamp=$STAMP confirm=${CONFIRM_METRICS_LOCK:-}"
echo "compose=${API_COMPOSE[*]}"

for f in docker-compose.yml docker-compose.testnet.yml docker-compose.gcp-testnet.yml; do
  [[ -f "$f" ]] || { echo "FAIL: missing overlay $f"; exit 2; }
done
[[ -d "$SRC" ]] || { echo "FAIL: missing $SRC"; exit 2; }
[[ -f "$SRC/metrics_auth.go" ]] || { echo "FAIL: missing $SRC/metrics_auth.go"; exit 2; }
[[ -f "$SRC/metrics.go" ]] || { echo "FAIL: missing $SRC/metrics.go"; exit 2; }
grep -q 'RequireMetricsAccess' "$SRC/metrics_auth.go"
grep -q 'middleware.RequireMetricsAccess' "$SRC/metrics.go"

echo "--- current image ---"
sudo docker inspect -f 'id={{.Image}} created={{.Created}} started={{.State.StartedAt}}' "$CTR"
EDGE_A_STARTED_BEFORE=$(sudo docker inspect -f '{{.State.StartedAt}}' "$EDGE_A")
echo "edge-a started=$EDGE_A_STARTED_BEFORE"

echo "--- current env ---"
for k in PROXYHUB_SESSION_CAPABILITY PROXYHUB_SESSION_CAPABILITY_OPERATOR_MINT PROXYHUB_LISTING_COMMITMENT GATEWAY_OP_A_HOST_ID GATEWAY_OP_B_HOST_ID PROXYHUB_GATEWAY_SLASH_AUTO PROXYHUB_GATEWAY_SLASH_CONFIRM PROXYHUB_METRICS_TOKEN; do
  v=$(sudo docker exec "$CTR" printenv "$k" 2>/dev/null || echo unset)
  echo "$k=$v"
done

cap=$(sudo docker exec "$CTR" printenv PROXYHUB_SESSION_CAPABILITY 2>/dev/null | tr -d '\r' || echo unset)
listing=$(sudo docker exec "$CTR" printenv PROXYHUB_LISTING_COMMITMENT 2>/dev/null | tr -d '\r' || echo unset)
slash_auto=$(sudo docker exec "$CTR" printenv PROXYHUB_GATEWAY_SLASH_AUTO 2>/dev/null || true)
slash_confirm=$(sudo docker exec "$CTR" printenv PROXYHUB_GATEWAY_SLASH_CONFIRM 2>/dev/null || true)
if [[ -n "${slash_auto:-}" || -n "${slash_confirm:-}" ]]; then
  echo "FAIL: slash dual-gate is set; abort"
  exit 2
fi
[[ "$listing" == "observe" || "$listing" == "off" || "$listing" == "unset" || -z "$listing" ]] || {
  echo "WARN: listing commitment is '$listing' (continuing if not enforce-slash)"
}

if [[ "${CONFIRM_METRICS_LOCK:-}" != "1" ]]; then
  echo "INSPECT ONLY: set CONFIRM_METRICS_LOCK=1 to patch Caddy, sync, build, and swap"
  exit 0
fi

patch_caddy() {
  [[ -f "$CADDY" ]] || { echo "FAIL: missing $CADDY"; exit 2; }
  if grep -q 'handle /metrics' "$CADDY"; then
    echo "caddy already has /metrics handle"
    return 0
  fi
  sudo cp -a "$CADDY" "${CADDY}.bak-metrics-lock-${STAMP}"
  python3 - "$CADDY" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1])
text = p.read_text()
if "handle /metrics" in text:
    print("caddy already patched")
    raise SystemExit(0)
old = """api.proxyhubb.com {
	encode gzip
	reverse_proxy 127.0.0.1:8080
}
"""
new = """api.proxyhubb.com {
	encode gzip
	handle /metrics* {
		respond 404
	}
	handle {
		reverse_proxy 127.0.0.1:8080
	}
}
"""
if old not in text:
    raise SystemExit("FAIL: unexpected api.proxyhubb.com block")
p.write_text(text.replace(old, new, 1))
print("caddy patched")
PY
  sudo caddy validate --config "$CADDY"
  if command -v systemctl >/dev/null 2>&1; then
    sudo systemctl reload caddy
  else
    sudo caddy reload --config "$CADDY"
  fi
  echo "caddy reloaded"
}

echo "--- Caddy public /metrics 404 ---"
patch_caddy
pub=$(curl -sS -o /tmp/metrics-public.body -w '%{http_code}' --max-time 15 https://api.proxyhubb.com/metrics || echo fail)
echo "public_metrics_https=$pub"
# 404 is success. 200 means Caddy still proxying (continue to API roll).

echo "--- tag previous image ---"
sudo docker tag proxyhubb-control-api "$TAG"
echo "rollback_tag=$TAG"

echo "--- sync source ---"
sudo mkdir -p "$ROOT/services/control-api/internal/middleware" "$ROOT/services/control-api/internal/monitoring"
tr -d '\015' < "$SRC/metrics_auth.go" | sudo tee "$ROOT/services/control-api/internal/middleware/metrics_auth.go" >/dev/null
tr -d '\015' < "$SRC/metrics.go" | sudo tee "$ROOT/services/control-api/internal/monitoring/metrics.go" >/dev/null

MAIN="$ROOT/services/control-api/main.go"
if grep -q 'RequireMetricsAccess(), middleware.CircuitBreakerStatsHandler' "$MAIN"; then
  echo "main.go circuit-breakers already wrapped"
else
  sudo python3 - "$MAIN" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
text = p.read_text()
old = 'r.GET("/metrics/circuit-breakers", middleware.CircuitBreakerStatsHandler())'
new = 'r.GET("/metrics/circuit-breakers", middleware.RequireMetricsAccess(), middleware.CircuitBreakerStatsHandler())'
if new in text:
    print("main.go already wrapped")
elif old not in text:
    raise SystemExit("FAIL: circuit-breakers route not found in main.go")
else:
    p.write_text(text.replace(old, new, 1))
    print("main.go wrapped")
PY
fi
sudo sed -i 's/\r$//' "$MAIN" "$ROOT/services/control-api/internal/middleware/metrics_auth.go" "$ROOT/services/control-api/internal/monitoring/metrics.go"
grep -q 'RequireMetricsAccess' "$ROOT/services/control-api/internal/middleware/metrics_auth.go"
grep -q 'middleware.RequireMetricsAccess' "$ROOT/services/control-api/internal/monitoring/metrics.go"
grep -q 'RequireMetricsAccess' "$MAIN"

echo "--- build ---"
sudo docker compose "${API_COMPOSE[@]}" build control-api

echo "--- swap control-api only (no --remove-orphans, no edges) ---"
sudo docker compose "${API_COMPOSE[@]}" up -d --no-deps --force-recreate control-api

echo "--- wait healthy ---"
ok=0
for i in $(seq 1 40); do
  st=$(sudo docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$CTR" 2>/dev/null || echo missing)
  echo "try=$i health=$st"
  if [[ "$st" == "healthy" ]]; then
    ok=1
    break
  fi
  sleep 3
done
[[ "$ok" == "1" ]] || { echo "FAIL: control-api not healthy"; sudo docker logs --tail 80 "$CTR" || true; exit 2; }

echo "--- verify env unchanged ---"
cap2=$(sudo docker exec "$CTR" printenv PROXYHUB_SESSION_CAPABILITY 2>/dev/null | tr -d '\r' || echo unset)
listing2=$(sudo docker exec "$CTR" printenv PROXYHUB_LISTING_COMMITMENT 2>/dev/null | tr -d '\r' || echo unset)
hid_a=$(sudo docker exec "$CTR" printenv GATEWAY_OP_A_HOST_ID 2>/dev/null | tr -d '\r' || echo unset)
echo "PROXYHUB_SESSION_CAPABILITY=$cap2"
echo "PROXYHUB_LISTING_COMMITMENT=$listing2"
echo "GATEWAY_OP_A_HOST_ID=$hid_a"
[[ "$cap2" == "$cap" ]] || { echo "FAIL: capability flipped $cap -> $cap2"; exit 2; }
slash_auto2=$(sudo docker exec "$CTR" printenv PROXYHUB_GATEWAY_SLASH_AUTO 2>/dev/null || true)
slash_confirm2=$(sudo docker exec "$CTR" printenv PROXYHUB_GATEWAY_SLASH_CONFIRM 2>/dev/null || true)
if [[ -n "${slash_auto2:-}" || -n "${slash_confirm2:-}" ]]; then
  echo "FAIL: slash dual-gate appeared after swap"
  exit 2
fi

EDGE_A_STARTED_AFTER=$(sudo docker inspect -f '{{.State.StartedAt}}' "$EDGE_A")
[[ "$EDGE_A_STARTED_BEFORE" == "$EDGE_A_STARTED_AFTER" ]] || { echo "FAIL: edge-a was recreated"; exit 2; }

echo "--- smoke ---"
curl -fsS http://127.0.0.1:8080/health
echo
internal=$(curl -sS -o /tmp/metrics-internal.body -w '%{http_code}' --max-time 15 -H 'Host: control-api:8080' http://127.0.0.1:8080/metrics || echo fail)
echo "internal_metrics=$internal"
[[ "$internal" == "200" ]] || { echo "FAIL: internal /metrics not 200"; head -c 200 /tmp/metrics-internal.body; echo; exit 2; }
public_host=$(curl -sS -o /tmp/metrics-host.body -w '%{http_code}' --max-time 15 -H 'Host: api.proxyhubb.com' http://127.0.0.1:8080/metrics || echo fail)
echo "api_host_metrics=$public_host"
[[ "$public_host" == "404" ]] || { echo "FAIL: Host api.proxyhubb.com /metrics got $public_host want 404"; exit 2; }
xff=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 -H 'Host: 127.0.0.1:8080' -H 'X-Forwarded-For: 203.0.113.9' http://127.0.0.1:8080/metrics || echo fail)
echo "xff_metrics=$xff"
[[ "$xff" == "404" ]] || { echo "FAIL: X-Forwarded-For /metrics got $xff want 404"; exit 2; }

pub2=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 https://api.proxyhubb.com/metrics || echo fail)
echo "public_metrics_https_after=$pub2"
[[ "$pub2" == "404" ]] || { echo "FAIL: public https /metrics got $pub2 want 404"; exit 2; }

echo METRICS_LOCK_DEPLOY_OK
echo rollback_tag="$TAG"
echo HMAC_CONTROL_GROUP_INTACT

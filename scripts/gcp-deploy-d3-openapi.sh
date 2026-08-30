#!/usr/bin/env bash
# D.3 — serve the OpenAPI contract from the API host: /openapi.json + /openapi.yaml
# redirect to the docs-hosted spec (docs.proxyhubb.com/openapi.yaml, repo-authoritative).
# Ships internal/api/openapi_spec.go + the RegisterOpenAPISpecRoutes call in main.go.
# Never --remove-orphans. Never recreate edge-a. Never slash gates.
#
# Upload payload to /tmp/d3-openapi/ then:
#   CONFIRM_D3_OPENAPI=1 bash /tmp/gcp-deploy-d3-openapi.sh
set -euo pipefail
ROOT="${PROJECT_DIR:-/opt/proxyhubb}"
CTR=proxyhubb-control-api-1
EDGE_A=proxyhubb-edge-gateway-a-1
STAMP="${ROLL_STAMP:-$(date -u +%Y%m%d-%H%M)}"
TAG="proxyhubb-control-api:pre-d3-openapi-${STAMP}"
SRC="${D3_SRC:-/tmp/d3-openapi}"

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

echo "=== D.3 openapi spec route ==="
echo "root=$ROOT stamp=$STAMP confirm=${CONFIRM_D3_OPENAPI:-}"

for f in docker-compose.yml docker-compose.testnet.yml docker-compose.gcp-testnet.yml; do
  [[ -f "$f" ]] || { echo "FAIL: missing overlay $f"; exit 2; }
done
[[ -d "$SRC" ]] || { echo "FAIL: missing $SRC"; exit 2; }
[[ -f "$SRC/openapi_spec.go" ]] || { echo "FAIL: missing $SRC/openapi_spec.go"; exit 2; }
[[ -f "$SRC/main.go" ]] || { echo "FAIL: missing $SRC/main.go"; exit 2; }
grep -q 'RegisterOpenAPISpecRoutes' "$SRC/openapi_spec.go"
grep -q 'api.RegisterOpenAPISpecRoutes(r)' "$SRC/main.go"
# main.go must still carry the D.1 metrics wrap (do not regress the lock)
grep -q 'RequireMetricsAccess(), middleware.CircuitBreakerStatsHandler' "$SRC/main.go"

echo "--- current image ---"
sudo docker inspect -f 'id={{.Image}} created={{.Created}} started={{.State.StartedAt}}' "$CTR"
EDGE_A_STARTED_BEFORE=$(sudo docker inspect -f '{{.State.StartedAt}}' "$EDGE_A")
echo "edge-a started=$EDGE_A_STARTED_BEFORE"

slash_auto=$(sudo docker exec "$CTR" printenv PROXYHUB_GATEWAY_SLASH_AUTO 2>/dev/null || true)
slash_confirm=$(sudo docker exec "$CTR" printenv PROXYHUB_GATEWAY_SLASH_CONFIRM 2>/dev/null || true)
if [[ -n "${slash_auto:-}" || -n "${slash_confirm:-}" ]]; then
  echo "FAIL: slash dual-gate is set; abort"
  exit 2
fi

if [[ "${CONFIRM_D3_OPENAPI:-}" != "1" ]]; then
  echo "INSPECT ONLY: set CONFIRM_D3_OPENAPI=1 to sync, build, and swap"
  exit 0
fi

echo "--- tag previous image ---"
sudo docker tag proxyhubb-control-api "$TAG"
echo "rollback_tag=$TAG"

echo "--- sync source ---"
sudo mkdir -p "$ROOT/services/control-api/internal/api"
tr -d '\015' < "$SRC/openapi_spec.go" | sudo tee "$ROOT/services/control-api/internal/api/openapi_spec.go" >/dev/null
tr -d '\015' < "$SRC/main.go" | sudo tee "$ROOT/services/control-api/main.go" >/dev/null
sudo sed -i 's/\r$//' "$ROOT/services/control-api/internal/api/openapi_spec.go" "$ROOT/services/control-api/main.go"
grep -q 'RegisterOpenAPISpecRoutes' "$ROOT/services/control-api/internal/api/openapi_spec.go"
grep -q 'api.RegisterOpenAPISpecRoutes(r)' "$ROOT/services/control-api/main.go"

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

EDGE_A_STARTED_AFTER=$(sudo docker inspect -f '{{.State.StartedAt}}' "$EDGE_A")
[[ "$EDGE_A_STARTED_BEFORE" == "$EDGE_A_STARTED_AFTER" ]] || { echo "FAIL: edge-a was recreated"; exit 2; }

echo "--- smoke ---"
curl -fsS http://127.0.0.1:8080/health >/dev/null
echo "health=200"
loc=$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 15 http://127.0.0.1:8080/openapi.json || echo fail)
echo "local_openapi_json=$loc"
[[ "$loc" == 302*https://docs.proxyhubb.com/openapi.yaml* ]] || { echo "FAIL: local /openapi.json got '$loc'"; exit 2; }
pub=$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 15 https://api.proxyhubb.com/openapi.json || echo fail)
echo "public_openapi_json=$pub"
[[ "$pub" == 302*https://docs.proxyhubb.com/openapi.yaml* ]] || { echo "FAIL: public /openapi.json got '$pub'"; exit 2; }
spec=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 https://docs.proxyhubb.com/openapi.yaml || echo fail)
echo "docs_spec=$spec"
[[ "$spec" == "200" ]] || { echo "FAIL: docs spec got $spec want 200"; exit 2; }
# D.1 regression check: public /metrics must stay 404
met=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 https://api.proxyhubb.com/metrics || echo fail)
echo "public_metrics=$met"
[[ "$met" == "404" ]] || { echo "FAIL: public /metrics got $met want 404 (D.1 regression)"; exit 2; }

echo D3_OPENAPI_DEPLOY_OK
echo rollback_tag="$TAG"

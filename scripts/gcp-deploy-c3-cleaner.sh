#!/usr/bin/env bash
# C.3 — deploy unfunded-escrow cleaner to Host-A control-api.
# Mirrors gcp-deploy-metrics-lock.sh safety: tag previous image, no --remove-orphans,
# never recreate edge-a, verify health + env invariance.
#
# Upload payload to /tmp/c3-deploy/ then:
#   CONFIRM_C3_DEPLOY=1 bash /tmp/c3-deploy/gcp-deploy-c3-cleaner.sh
set -euo pipefail
ROOT="${PROJECT_DIR:-/opt/proxyhubb}"
CTR=proxyhubb-control-api-1
EDGE_A=proxyhubb-edge-gateway-a-1
STAMP="${ROLL_STAMP:-$(date -u +%Y%m%d-%H%M)}"
TAG="proxyhubb-control-api:pre-c3-cleaner-${STAMP}"
SRC="${C3_SRC:-/tmp/c3-deploy}"

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

echo "=== C.3 unfunded cleaner deploy ==="
echo "root=$ROOT stamp=$STAMP confirm=${CONFIRM_C3_DEPLOY:-}"

for f in docker-compose.yml docker-compose.testnet.yml docker-compose.gcp-testnet.yml; do
  [[ -f "$f" ]] || { echo "FAIL: missing overlay $f"; exit 2; }
done
[[ -f "$SRC/escrow_cleaner.go" ]] || { echo "FAIL: missing $SRC/escrow_cleaner.go"; exit 2; }
grep -q 'shouldCancelUnfundedPending' "$SRC/escrow_cleaner.go"
grep -q 'PROXYHUB_UNFUNDED_ESCROW_TIMEOUT' "$SRC/escrow_cleaner.go"

echo "--- deps present on VM source tree ---"
grep -q 'func ValidateSessionStatusTransition' "$ROOT/services/control-api/internal/models/state_transitions.go" || { echo "FAIL: ValidateSessionStatusTransition missing"; exit 2; }
grep -q 'type SettleEscrowParams' "$ROOT/services/control-api/internal/solana/settlement.go" || { echo "FAIL: SettleEscrowParams missing"; exit 2; }
grep -q 'func recordEscrowReconciliation' "$ROOT/services/control-api/internal/worker/escrow_reconciliation.go" || { echo "FAIL: recordEscrowReconciliation missing"; exit 2; }
echo "deps ok"

echo "--- current image ---"
sudo docker inspect -f 'id={{.Image}} created={{.Created}} started={{.State.StartedAt}}' "$CTR"
EDGE_A_STARTED_BEFORE=$(sudo docker inspect -f '{{.State.StartedAt}}' "$EDGE_A")
echo "edge-a started=$EDGE_A_STARTED_BEFORE"

echo "--- env snapshot ---"
for k in PROXYHUB_SESSION_CAPABILITY PROXYHUB_LISTING_COMMITMENT PROXYHUB_METRICS_TOKEN PROXYHUB_UNFUNDED_ESCROW_TIMEOUT; do
  v=$(sudo docker exec "$CTR" printenv "$k" 2>/dev/null || echo unset)
  echo "$k=$v"
done
slash_auto=$(sudo docker exec "$CTR" printenv PROXYHUB_GATEWAY_SLASH_AUTO 2>/dev/null || true)
slash_confirm=$(sudo docker exec "$CTR" printenv PROXYHUB_GATEWAY_SLASH_CONFIRM 2>/dev/null || true)
if [[ -n "${slash_auto:-}" || -n "${slash_confirm:-}" ]]; then
  echo "FAIL: slash dual-gate is set; abort"
  exit 2
fi

cap_before=$(sudo docker exec "$CTR" printenv PROXYHUB_SESSION_CAPABILITY 2>/dev/null | tr -d '\r' || echo unset)

if [[ "${CONFIRM_C3_DEPLOY:-}" != "1" ]]; then
  echo "INSPECT ONLY: set CONFIRM_C3_DEPLOY=1 to sync, build, and swap"
  exit 0
fi

echo "--- tag previous image ---"
sudo docker tag proxyhubb-control-api "$TAG"
echo "rollback_tag=$TAG"

echo "--- sync source ---"
sudo mkdir -p "$ROOT/services/control-api/internal/worker" "$ROOT/services/control-api/internal/api"
tr -d '\015' < "$SRC/escrow_cleaner.go" | sudo tee "$ROOT/services/control-api/internal/worker/escrow_cleaner.go" >/dev/null
if [[ -f "$SRC/escrow_cleaner_test.go" ]]; then
  tr -d '\015' < "$SRC/escrow_cleaner_test.go" | sudo tee "$ROOT/services/control-api/internal/worker/escrow_cleaner_test.go" >/dev/null
fi
if [[ -f "$SRC/orders_test.go" ]]; then
  tr -d '\015' < "$SRC/orders_test.go" | sudo tee "$ROOT/services/control-api/internal/api/orders_test.go" >/dev/null
fi
grep -q 'shouldCancelUnfundedPending' "$ROOT/services/control-api/internal/worker/escrow_cleaner.go"

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

echo "--- verify ---"
cap_after=$(sudo docker exec "$CTR" printenv PROXYHUB_SESSION_CAPABILITY 2>/dev/null | tr -d '\r' || echo unset)
[[ "$cap_after" == "$cap_before" ]] || { echo "FAIL: capability flipped $cap_before -> $cap_after"; exit 2; }
slash_auto2=$(sudo docker exec "$CTR" printenv PROXYHUB_GATEWAY_SLASH_AUTO 2>/dev/null || true)
slash_confirm2=$(sudo docker exec "$CTR" printenv PROXYHUB_GATEWAY_SLASH_CONFIRM 2>/dev/null || true)
if [[ -n "${slash_auto2:-}" || -n "${slash_confirm2:-}" ]]; then
  echo "FAIL: slash dual-gate appeared after swap"
  exit 2
fi
EDGE_A_STARTED_AFTER=$(sudo docker inspect -f '{{.State.StartedAt}}' "$EDGE_A")
[[ "$EDGE_A_STARTED_BEFORE" == "$EDGE_A_STARTED_AFTER" ]] || { echo "FAIL: edge-a was recreated"; exit 2; }

curl -fsS http://127.0.0.1:8080/health >/dev/null && echo "health ok"
pub=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 https://api.proxyhubb.com/metrics || echo fail)
echo "public_metrics_https=$pub"
[[ "$pub" == "404" ]] || { echo "FAIL: public /metrics regressed to $pub"; exit 2; }

sudo docker logs --tail 200 "$CTR" 2>&1 | grep -i 'escrowcleaner' | tail -5 || echo "(no cleaner log lines yet)"

echo C3_CLEANER_DEPLOY_OK
echo rollback_tag="$TAG"

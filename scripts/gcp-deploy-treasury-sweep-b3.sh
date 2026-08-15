#!/usr/bin/env bash
# Deploy B3 hot→cold sweep (multi-sig) to GCP testnet control-api.
set -euo pipefail
PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
DEPLOY_TAR="${DEPLOY_TAR:?}"
DOCKER="${DOCKER:-docker}"
cd "$PROJECT_DIR"

tmpdir=$(mktemp -d)
tar -xzf "$DEPLOY_TAR" -C "$tmpdir"
[[ -d "$tmpdir/control-api" ]] && cp -a "$tmpdir/control-api/." "$PROJECT_DIR/services/control-api/"
for f in docker-compose.yml docker-compose.gcp-testnet.yml docker-compose.dev.yml; do
  [[ -f "$tmpdir/$f" ]] && cp -a "$tmpdir/$f" "$PROJECT_DIR/$f"
done
rm -rf "$tmpdir"

strip_cr() {
  local f="$1" tmpf
  tmpf=$(mktemp)
  tr -d '\015' < "$f" > "$tmpf" && mv "$tmpf" "$f"
}
find "$PROJECT_DIR/services/control-api" -type f -name '*.go' -print0 2>/dev/null \
  | while IFS= read -r -d '' f; do strip_cr "$f"; done
for f in docker-compose.yml docker-compose.gcp-testnet.yml docker-compose.dev.yml; do
  [[ -f "$PROJECT_DIR/$f" ]] && strip_cr "$PROJECT_DIR/$f"
done

grep -q 'ProposeHotToColdSweepIfNeeded' "$PROJECT_DIR/services/control-api/internal/treasury/treasury_manager.go"
grep -q 'ActionHotToCold' "$PROJECT_DIR/services/control-api/internal/gov/governor.go"
grep -q 'propose-hot-to-cold' "$PROJECT_DIR/services/control-api/internal/api/treasury_multisig.go"
grep -q 'SOLANA_TREASURY_SWEEP_ENABLED' "$PROJECT_DIR/docker-compose.gcp-testnet.yml"
echo SOURCES_OK

COMPOSE=("$DOCKER" compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
"${COMPOSE[@]}" build control-api
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api

for i in $(seq 1 60); do
  st=$("${COMPOSE[@]}" ps control-api --format '{{.Status}}' || true)
  echo "try=$i $st"
  echo "$st" | grep -qi healthy && break
  sleep 5
done
echo "$st" | grep -qi healthy

echo "=== sweep env ==="
"${COMPOSE[@]}" exec -T control-api printenv SOLANA_TREASURY_SWEEP_ENABLED || true
"${COMPOSE[@]}" exec -T control-api printenv SOLANA_TREASURY_HOT_MAX_BALANCE || true

echo "=== public liquidity ==="
curl -sS http://127.0.0.1:18080/v1/treasury/public > /tmp/treasury-b3.json
python3 - <<'PY'
import json
t=json.load(open("/tmp/treasury-b3.json"))["treasury"]
liq=t.get("liquidity") or {}
print("status", t.get("status"))
print("hot", t["hot"]["balance_sol"], "max", t["hot"].get("max_balance_sol"))
print("sweep_enabled", liq.get("sweep_enabled"), "hot_max_sol", liq.get("hot_max_sol"))
assert liq.get("sweep_enabled") is True
assert float(liq.get("hot_max_sol") or 0) > 0
print("B3_LIQUIDITY_OK")
PY

echo "=== boot logs ==="
"$DOCKER" logs proxyhubb-control-api-1 2>&1 | grep -E 'Treasury auto-topup|Withdrawal payout|sweep|Hot' | tail -n 15 || true
echo B3_SWEEP_DEPLOY_DONE

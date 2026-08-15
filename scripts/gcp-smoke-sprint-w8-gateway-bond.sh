#!/usr/bin/env bash
# Wave 8 — bonded-gateway program (unit + honesty). Does not deploy.
#
# Live deploy is a separate soak and stays unclaimed:
#   CONFIRM_W8_DEPLOY=1  — this script still refuses to deploy.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API="${CONTROL_API_URL:-http://127.0.0.1:18080}"
API_DIR="$ROOT/services/control-api"

echo "=== W8.A bonded-gateway (no deploy) ==="

if [[ "${CONFIRM_W8_DEPLOY:-}" == "1" ]]; then
  echo "REFUSE: CONFIRM_W8_DEPLOY=1 is not a deploy tool. Generate a keypair, replace declare_id, and use a dedicated deploy script. Never deploy programs/session."
  exit 2
fi

echo "--- go unit ---"
(cd "$API_DIR" && go test ./internal/solana/ ./internal/gateways/ -count=1 -run 'GatewayBond|SlashGate|SlashExecute|HonestyMeta|SlashLamports')
echo "W8A_GO_OK"

echo "--- rust math ---"
if command -v cargo >/dev/null 2>&1; then
  cargo test --manifest-path "$ROOT/programs/gateway-bond/Cargo.toml" --lib -- --nocapture
  echo "W8A_RUST_OK"
else
  echo "W8A_RUST_SKIP (cargo not on PATH)"
fi

echo "--- CLI ---"
(cd "$API_DIR" && go run ./cmd/w8-gateway-bond id)
(cd "$API_DIR" && go run ./cmd/w8-gateway-bond gates)

echo "--- live honesty (optional) ---"
HONESTY=$(curl -fsS "$API/v1/system/config/public" 2>/dev/null | python3 -c 'import json,sys
d=json.load(sys.stdin)
g=d.get("gateway_operators") or {}
print("slash="+str(g.get("live_economic_slash"))+" session="+str(g.get("programs_session"))+" bond="+str(g.get("bonded_gateway_program"))+" exec="+str(g.get("gateway_slash_execute")))' || true)
echo "honesty=$HONESTY"

echo "W8A_BOND_PROGRAM_OK"
echo "live_economic_slash remains unclaimed; programs/session stays undeployed"

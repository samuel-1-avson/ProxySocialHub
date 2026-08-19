#!/usr/bin/env bash
# Leave PROXYHUB_LISTING_COMMITMENT=observe on Host-A after the 2026-08-17 roll.
# Does not restore off. Does not publish a listing (no extra SOL send here).
# Capability stays observe. Never --remove-orphans. Never slash gates.
#
#   CONFIRM_W10B_LEAVE_OBSERVE=1 bash /tmp/gcp-host-a-listing-commitment-observe.sh
set -euo pipefail
if [[ "${CONFIRM_W10B_LEAVE_OBSERVE:-}" != "1" ]]; then
  echo "REFUSE: set CONFIRM_W10B_LEAVE_OBSERVE=1 on Host-A"
  exit 2
fi
ROOT="${PROJECT_DIR:-/opt/proxyhubb}"
API="${CONTROL_API_URL:-http://127.0.0.1:18080}"
CTR=proxyhubb-control-api-1
SRC_OVERLAY="${LISTING_OVERLAY:-/tmp/docker-compose.w10-listing-observe.yml}"
cd "$ROOT"

COMPOSE=( -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml -f docker-compose.w6-host-a-private.yml -f docker-compose.w10-observe.yml -f docker-compose.w10-listing-observe.yml )

echo "=== W10.B listing-commitment observe (leave on) ==="
[[ -f "$SRC_OVERLAY" ]] || { echo "FAIL: missing $SRC_OVERLAY"; exit 2; }
for f in docker-compose.yml docker-compose.testnet.yml docker-compose.gcp-testnet.yml docker-compose.w6-host-a-private.yml docker-compose.w10-observe.yml; do
  [[ -f "$f" ]] || { echo "FAIL: missing overlay $f"; exit 2; }
done

cap=$(sudo docker exec "$CTR" printenv PROXYHUB_SESSION_CAPABILITY 2>/dev/null || echo unset)
[[ "$cap" == "observe" ]] || { echo "FAIL: capability is '$cap' not observe"; exit 2; }
slash_auto=$(sudo docker exec "$CTR" printenv PROXYHUB_GATEWAY_SLASH_AUTO 2>/dev/null || true)
slash_confirm=$(sudo docker exec "$CTR" printenv PROXYHUB_GATEWAY_SLASH_CONFIRM 2>/dev/null || true)
if [[ -n "${slash_auto:-}" || -n "${slash_confirm:-}" ]]; then
  echo "FAIL: slash dual-gate is set"
  exit 2
fi

stamp=$(date -u +%Y%m%d%H%M%S)
sudo cp -a .env ".env.bak.w10b-listing-$stamp"
sudo cp -a "$SRC_OVERLAY" "$ROOT/docker-compose.w10-listing-observe.yml"
sudo python3 - "$ROOT/.env" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
key, val = "PROXYHUB_LISTING_COMMITMENT", "observe"
text = p.read_text() if p.exists() else ""
lines = [ln for ln in text.splitlines() if not ln.startswith(key + "=")]
lines.append(f"{key}={val}")
p.write_text("\n".join(lines) + "\n")
print("env_listing_commitment=observe")
PY

echo "--- recreate control-api (no --remove-orphans) ---"
sudo docker compose "${COMPOSE[@]}" up -d --no-deps --force-recreate control-api

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
[[ "$ok" == "1" ]] || { echo "FAIL: control-api not healthy"; exit 2; }

mode=$(sudo docker exec "$CTR" printenv PROXYHUB_LISTING_COMMITMENT | tr -d '\r')
cap2=$(sudo docker exec "$CTR" printenv PROXYHUB_SESSION_CAPABILITY | tr -d '\r')
hid_a=$(sudo docker exec "$CTR" printenv GATEWAY_OP_A_HOST_ID | tr -d '\r')
hid_b=$(sudo docker exec "$CTR" printenv GATEWAY_OP_B_HOST_ID | tr -d '\r')
echo "PROXYHUB_LISTING_COMMITMENT=$mode"
echo "PROXYHUB_SESSION_CAPABILITY=$cap2"
echo "GATEWAY_OP_A_HOST_ID=$hid_a"
echo "GATEWAY_OP_B_HOST_ID=$hid_b"
[[ "$mode" == "observe" ]] || { echo "FAIL: listing mode $mode"; exit 2; }
[[ "$cap2" == "observe" ]] || { echo "FAIL: capability $cap2"; exit 2; }
[[ "$hid_a" == "gce-proxyhubb-testnet" ]] || { echo "FAIL: host a $hid_a"; exit 2; }
[[ "$hid_b" == "gce-w6-operator-b" ]] || { echo "FAIL: host b $hid_b"; exit 2; }

python3 - <<'PY'
import json, urllib.request, sys
raw = urllib.request.urlopen("http://127.0.0.1:18080/v1/system/config/public", timeout=10).read()
d = json.loads(raw)
disc = d.get("discovery") or {}
cap = d.get("session_capability") or {}
g = d.get("gateway_operators") or {}
mode = str(disc.get("listing_commitment_mode") or "")
comm = str(disc.get("listing_commitments") or "")
print("mode="+mode+" commitments="+comm+" catalog="+str(disc.get("catalog_source") or "")+" delist="+str(disc.get("delist_authority") or ""))
print("session_capability_mode="+str(cap.get("session_capability_mode")))
print("session_capability_issuer="+str(cap.get("session_capability_issuer")))
print("live_economic_slash="+str(g.get("live_economic_slash")).lower())
print("operator_org_diversity="+str(g.get("operator_org_diversity")))
assert mode == "observe", disc
assert comm == "ed25519_offer_hash+listing_commitment_pda", disc
assert str(disc.get("catalog_source")) == "postgres", disc
assert str(disc.get("delist_authority")) == "platform_moderation", disc
assert str(cap.get("session_capability_mode")) == "observe", cap
assert g.get("live_economic_slash") is False, g
assert str(g.get("operator_org_diversity")) == "same_org", g
print("W10B_LISTING_COMMITMENT_OBSERVE_LEFT_ON")
PY

echo "no listing publish in this step (register tx not sent)"
echo "mode left observe; slash gates off; capability observe; not DePIN"

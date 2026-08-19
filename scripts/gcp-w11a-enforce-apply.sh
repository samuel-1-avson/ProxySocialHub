#!/usr/bin/env bash
# Written W11.A enforce on Host-A soak fleet (control-api + J2 edge-b).
# edge-a :8090 stays HMAC. Listing observe stays. Slash unset.
# Never --remove-orphans.
#
#   CONFIRM_W11A_ENFORCE=1 bash /tmp/gcp-w11a-enforce-apply.sh
set -euo pipefail
if [[ "${CONFIRM_W11A_ENFORCE:-}" != "1" ]]; then
  echo "REFUSE: set CONFIRM_W11A_ENFORCE=1"
  exit 2
fi
ROOT="${PROJECT_DIR:-/opt/proxyhubb}"
cd "$ROOT"
API_CTR=proxyhubb-control-api-1
EDGE_CTR=proxyhubb-edge-gateway-b-1

slash_auto=$(sudo docker exec "$API_CTR" printenv PROXYHUB_GATEWAY_SLASH_AUTO 2>/dev/null || true)
slash_confirm=$(sudo docker exec "$API_CTR" printenv PROXYHUB_GATEWAY_SLASH_CONFIRM 2>/dev/null || true)
if [[ -n "${slash_auto:-}" || -n "${slash_confirm:-}" ]]; then
  echo "FAIL: slash dual-gate is set"
  exit 2
fi
listing=$(sudo docker exec "$API_CTR" printenv PROXYHUB_LISTING_COMMITMENT 2>/dev/null || echo unset)
[[ "$listing" == "observe" ]] || { echo "FAIL: listing is '$listing' not observe"; exit 2; }

for f in docker-compose.yml docker-compose.testnet.yml docker-compose.gcp-testnet.yml \
  docker-compose.w6-host-a-private.yml docker-compose.w10-observe.yml \
  docker-compose.w10-listing-observe.yml docker-compose.w11-enforce.yml \
  docker-compose.j2-multipod.yml docker-compose.redis-ha.yml \
  docker-compose.w10-observe-edge.yml docker-compose.w11-enforce-edge.yml; do
  [[ -f "$f" ]] || { echo "FAIL: missing $f"; exit 2; }
done
[[ -f /tmp/w5c2-redis-override.yml ]] || { echo "FAIL: missing /tmp/w5c2-redis-override.yml"; exit 2; }

wait_ctr() {
  local name="$1" i st
  for i in $(seq 1 40); do
    st=$(sudo docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$name" 2>/dev/null || echo missing)
    if [[ "$st" == "healthy" || "$st" == "running" ]]; then
      echo "$name $st"
      return 0
    fi
    echo "wait $name try=$i st=$st"
    sleep 3
  done
  echo "FAIL: $name not up"
  return 1
}

echo "=== pre image ==="
sudo docker inspect -f 'api={{.Image}} started={{.State.StartedAt}}' "$API_CTR"
sudo docker inspect -f 'edge-b={{.Image}} started={{.State.StartedAt}}' "$EDGE_CTR"
sudo docker tag "$(sudo docker inspect -f '{{.Image}}' "$API_CTR")" proxyhubb-control-api:pre-enforce-20260819 || true
sudo docker tag "$(sudo docker inspect -f '{{.Image}}' "$EDGE_CTR")" proxyhubb-edge-gateway-b:pre-enforce-20260819 || true
sudo docker inspect -f 'edge-a={{.Image}} started={{.State.StartedAt}}' proxyhubb-edge-gateway-a-1
EDGE_A_STARTED_BEFORE=$(sudo docker inspect -f '{{.State.StartedAt}}' proxyhubb-edge-gateway-a-1)

# 08-14 edge-b binary has comma-separated env issuers but not bundle
# verified_issuer_pubkeys (that landed 2026-08-15). Append pin pubkeys so
# operator-minted tokens work without rebuilding the HMAC control-group image.
PIN="${PROXYHUB_OPERATOR_BUNDLE_PATH:-$ROOT/ops/operators-bundle.json}"
BASE_ISSUER=$(sudo docker exec "$EDGE_CTR" printenv PROXYHUB_SESSION_CAPABILITY_ISSUER_PUBKEY | tr -d '\r')
EDGE_ISSUER=$(python3 - "$BASE_ISSUER" "$PIN" <<'PY'
import json, sys
base = sys.argv[1].strip()
have = [x.strip() for x in base.split(",") if x.strip()]
seen = set(have)
ops = json.load(open(sys.argv[2])).get("operators") or []
for o in ops:
    pk = (o.get("pubkey") or "").strip()
    if pk and pk not in seen:
        have.append(pk)
        seen.add(pk)
print(",".join(have))
PY
)
echo "edge_issuer_n=$(echo "$EDGE_ISSUER" | awk -F, '{print NF}')"

API_COMPOSE=(sudo docker compose
  -f docker-compose.yml
  -f docker-compose.testnet.yml
  -f docker-compose.gcp-testnet.yml
  -f docker-compose.w6-host-a-private.yml
  -f docker-compose.w10-observe.yml
  -f docker-compose.w10-listing-observe.yml
  -f docker-compose.w11-enforce.yml)

EDGE_COMPOSE=(sudo docker compose
  -f docker-compose.yml
  -f docker-compose.testnet.yml
  -f docker-compose.gcp-testnet.yml
  -f docker-compose.j2-multipod.yml
  -f /tmp/w5c2-redis-override.yml
  -f docker-compose.redis-ha.yml
  -f docker-compose.w6-host-a-private.yml
  -f docker-compose.w10-observe-edge.yml
  -f docker-compose.w11-enforce-edge.yml)

echo "=== recreate control-api (enforce + operator mint; listing observe) ==="
"${API_COMPOSE[@]}" up -d --no-deps --force-recreate control-api
wait_ctr "$API_CTR"

echo "=== recreate edge-gateway-b only (enforce). edge-a untouched ==="
# sudo drops exported env; pass the expanded issuer explicitly.
sudo PROXYHUB_SESSION_CAPABILITY_ISSUER_PUBKEY="$EDGE_ISSUER" docker compose \
  -f docker-compose.yml \
  -f docker-compose.testnet.yml \
  -f docker-compose.gcp-testnet.yml \
  -f docker-compose.j2-multipod.yml \
  -f /tmp/w5c2-redis-override.yml \
  -f docker-compose.redis-ha.yml \
  -f docker-compose.w6-host-a-private.yml \
  -f docker-compose.w10-observe-edge.yml \
  -f docker-compose.w11-enforce-edge.yml \
  up -d --no-deps --force-recreate edge-gateway-b
wait_ctr "$EDGE_CTR"

echo "=== post env ==="
echo -n "api_cap="; sudo docker exec "$API_CTR" printenv PROXYHUB_SESSION_CAPABILITY
echo -n "api_mint="; sudo docker exec "$API_CTR" printenv PROXYHUB_SESSION_CAPABILITY_OPERATOR_MINT
echo -n "api_listing="; sudo docker exec "$API_CTR" printenv PROXYHUB_LISTING_COMMITMENT
echo -n "api_host_a="; sudo docker exec "$API_CTR" printenv GATEWAY_OP_A_HOST_ID
echo -n "api_host_b="; sudo docker exec "$API_CTR" printenv GATEWAY_OP_B_HOST_ID
echo -n "edge_b_cap="; sudo docker exec "$EDGE_CTR" printenv PROXYHUB_SESSION_CAPABILITY
echo -n "edge_b_issuer_n="; sudo docker exec "$EDGE_CTR" printenv PROXYHUB_SESSION_CAPABILITY_ISSUER_PUBKEY | awk -F, '{print NF}'
echo -n "edge_a_cap="; sudo docker exec proxyhubb-edge-gateway-a-1 printenv PROXYHUB_SESSION_CAPABILITY || echo unset
echo -n "edge_a_started="; sudo docker inspect -f '{{.State.StartedAt}}' proxyhubb-edge-gateway-a-1
echo -n "slash_auto="; sudo docker exec "$API_CTR" printenv PROXYHUB_GATEWAY_SLASH_AUTO || true
echo -n "slash_confirm="; sudo docker exec "$API_CTR" printenv PROXYHUB_GATEWAY_SLASH_CONFIRM || true

api_cap=$(sudo docker exec "$API_CTR" printenv PROXYHUB_SESSION_CAPABILITY | tr -d '\r')
api_mint=$(sudo docker exec "$API_CTR" printenv PROXYHUB_SESSION_CAPABILITY_OPERATOR_MINT | tr -d '\r')
edge_cap=$(sudo docker exec "$EDGE_CTR" printenv PROXYHUB_SESSION_CAPABILITY | tr -d '\r')
[[ "$api_cap" == "enforce" ]] || { echo "FAIL: api cap $api_cap"; exit 2; }
[[ "$api_mint" == "enforce" ]] || { echo "FAIL: api mint $api_mint"; exit 2; }
[[ "$edge_cap" == "enforce" ]] || { echo "FAIL: edge-b cap $edge_cap"; exit 2; }
issuer_n=$(sudo docker exec "$EDGE_CTR" printenv PROXYHUB_SESSION_CAPABILITY_ISSUER_PUBKEY | awk -F, '{print NF}')
[[ "$issuer_n" -ge 4 ]] || { echo "FAIL: edge-b issuer_n=$issuer_n (want pin pubkeys on 08-14 binary)"; exit 2; }
listing=$(sudo docker exec "$API_CTR" printenv PROXYHUB_LISTING_COMMITMENT | tr -d '\r')
[[ "$listing" == "observe" ]] || { echo "FAIL: listing dropped to $listing"; exit 2; }
EDGE_A_STARTED_AFTER=$(sudo docker inspect -f '{{.State.StartedAt}}' proxyhubb-edge-gateway-a-1)
[[ "$EDGE_A_STARTED_BEFORE" == "$EDGE_A_STARTED_AFTER" ]] || { echo "FAIL: edge-a was recreated"; exit 2; }
echo "W11A_ENFORCE_APPLIED HMAC_CONTROL_GROUP_INTACT"

#!/usr/bin/env bash
# Re-apply edge-b issuer allowlist (sudo dropped the env on first recreate).
set -euo pipefail
ROOT="${PROJECT_DIR:-/opt/proxyhubb}"
cd "$ROOT"
EDGE_CTR=proxyhubb-edge-gateway-b-1
PIN="$ROOT/ops/operators-bundle.json"
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
EDGE_A_STARTED_BEFORE=$(sudo docker inspect -f '{{.State.StartedAt}}' proxyhubb-edge-gateway-a-1)
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
for i in $(seq 1 40); do
  st=$(sudo docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$EDGE_CTR")
  if [[ "$st" == "healthy" || "$st" == "running" ]]; then
    echo "$EDGE_CTR $st"
    break
  fi
  echo "wait $EDGE_CTR try=$i st=$st"
  sleep 3
done
echo -n "edge_b_cap="; sudo docker exec "$EDGE_CTR" printenv PROXYHUB_SESSION_CAPABILITY
echo -n "edge_b_issuer_n="; sudo docker exec "$EDGE_CTR" printenv PROXYHUB_SESSION_CAPABILITY_ISSUER_PUBKEY | awk -F, '{print NF}'
n=$(sudo docker exec "$EDGE_CTR" printenv PROXYHUB_SESSION_CAPABILITY_ISSUER_PUBKEY | awk -F, '{print NF}')
[[ "$n" -ge 4 ]] || { echo "FAIL: issuer_n=$n"; exit 2; }
EDGE_A_STARTED_AFTER=$(sudo docker inspect -f '{{.State.StartedAt}}' proxyhubb-edge-gateway-a-1)
[[ "$EDGE_A_STARTED_BEFORE" == "$EDGE_A_STARTED_AFTER" ]] || { echo "FAIL: edge-a was recreated"; exit 2; }
echo "W11A_EDGE_ISSUER_ALLOWLIST_OK"

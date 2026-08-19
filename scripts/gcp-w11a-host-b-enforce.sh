#!/usr/bin/env bash
# Host-B soak edge to capability enforce. Still same_org. Never slash.
#   CONFIRM_W11A_ENFORCE=1 bash /tmp/gcp-w11a-host-b-enforce.sh
set -euo pipefail
if [[ "${CONFIRM_W11A_ENFORCE:-}" != "1" ]]; then
  echo "REFUSE: set CONFIRM_W11A_ENFORCE=1"
  exit 2
fi
ROOT="${PROJECT_DIR:-/opt/proxyhubb}"
API="${CONTROL_API_URL:-https://api.proxyhubb.com}"
cd "$ROOT"
[[ -f docker-compose.w6-remote-edge.yml ]] || { echo "FAIL: missing w6-remote-edge"; exit 2; }
[[ -f docker-compose.w10-host-b-observe.yml ]] || { echo "FAIL: missing w10-host-b-observe"; exit 2; }
[[ -f docker-compose.w11-host-b-enforce.yml ]] || { echo "FAIL: missing w11-host-b-enforce"; exit 2; }

sudo mkdir -p "$ROOT/ops"
curl -fsS "$API/v1/gateways/operators/bundle" | sudo tee /tmp/operators-bundle.json >/dev/null
python3 - <<'PY'
import json
from pathlib import Path
b=json.loads(Path("/tmp/operators-bundle.json").read_text())
assert b.get("message_type")=="PROXYHUB_OPERATOR_MANIFEST_BUNDLE"
print("bundle_n="+str(len(b.get("operators") or [])))
PY
sudo cp /tmp/operators-bundle.json "$ROOT/ops/operators-bundle.json"
sudo chmod 644 "$ROOT/ops/operators-bundle.json"

export COMPOSE_PROJECT_NAME=proxyhubb
sudo docker compose \
  -f docker-compose.w6-remote-edge.yml \
  -f docker-compose.w10-host-b-observe.yml \
  -f docker-compose.w11-host-b-enforce.yml \
  up -d --no-deps --force-recreate edge-gateway-b

for i in $(seq 1 40); do
  st=$(sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' proxyhubb-edge-gateway-b-1 2>/dev/null || true)
  [[ "$st" == "healthy" || "$st" == "running" ]] && break
  echo "wait host-b try=$i st=$st"
  sleep 3
done
echo -n "host_b_cap="; sudo docker exec proxyhubb-edge-gateway-b-1 printenv PROXYHUB_SESSION_CAPABILITY
cap=$(sudo docker exec proxyhubb-edge-gateway-b-1 printenv PROXYHUB_SESSION_CAPABILITY | tr -d '\r')
[[ "$cap" == "enforce" ]] || { echo "FAIL: host-b cap $cap"; exit 2; }
curl -fsS http://127.0.0.1:8090/health
echo
echo "W11A_HOST_B_ENFORCE_OK same_org"

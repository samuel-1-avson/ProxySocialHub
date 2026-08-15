#!/usr/bin/env bash
# Wave 10.A/D — Host-B observe + pin operator bundle.
# Host-B never counts as org 2. Slash gates stay off.
#
#   CONFIRM_W10_PHASE_A=1 ./scripts/gcp-smoke-sprint-w10-host-b-observe.sh
set -euo pipefail
ROOT="${PROJECT_DIR:-/opt/proxyhubb}"
API="${CONTROL_API_URL:-https://api.proxyhubb.com}"

echo "=== W10.A/D Host-B observe ==="
if [[ "${CONFIRM_W10_PHASE_A:-}" != "1" ]]; then
  echo "REFUSE: set CONFIRM_W10_PHASE_A=1 on Host-B"
  exit 2
fi
if [[ ! -d "$ROOT" ]]; then
  echo "FAIL: $ROOT missing (run on Host-B)"
  exit 2
fi
cd "$ROOT"
if [[ ! -f "$ROOT/docker-compose.w10-host-b-observe.yml" ]]; then
  echo "FAIL: missing docker-compose.w10-host-b-observe.yml"
  exit 2
fi

sudo mkdir -p "$ROOT/ops"
curl -fsS "$API/v1/gateways/operators/bundle" -o /tmp/operators-bundle.json
python3 - <<'PY'
import json
from pathlib import Path
b=json.loads(Path("/tmp/operators-bundle.json").read_text())
assert b.get("message_type")=="PROXYHUB_OPERATOR_MANIFEST_BUNDLE"
print("bundle_n="+str(len(b.get("operators") or [])))
PY
sudo cp /tmp/operators-bundle.json "$ROOT/ops/operators-bundle.json"
sudo chmod 644 "$ROOT/ops/operators-bundle.json"

if [[ -z "${PROXYHUB_SESSION_CAPABILITY_ISSUER_PUBKEY:-}" ]]; then
  if [[ -f /tmp/w10a-issuer.pub ]]; then
    export PROXYHUB_SESSION_CAPABILITY_ISSUER_PUBKEY="$(tr -d '\r\n' </tmp/w10a-issuer.pub)"
  else
    echo "FAIL: PROXYHUB_SESSION_CAPABILITY_ISSUER_PUBKEY or /tmp/w10a-issuer.pub required"
    exit 2
  fi
fi

sudo python3 - "$ROOT/.env" "$PROXYHUB_SESSION_CAPABILITY_ISSUER_PUBKEY" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); pub=sys.argv[2]
text=p.read_text() if p.exists() else ""
drop=("PROXYHUB_SESSION_CAPABILITY=","PROXYHUB_SESSION_CAPABILITY_ISSUER_PUBKEY=","PROXYHUB_OPERATOR_BUNDLE_PATH=")
lines=[ln for ln in text.splitlines() if not ln.startswith(drop)]
lines += [
  "PROXYHUB_SESSION_CAPABILITY=observe",
  "PROXYHUB_SESSION_CAPABILITY_ISSUER_PUBKEY="+pub,
  "PROXYHUB_OPERATOR_BUNDLE_PATH=/etc/proxyhubb/operators-bundle.json",
]
p.write_text("\n".join(lines)+"\n")
print("host_b_env=observe")
PY

export COMPOSE_PROJECT_NAME=proxyhubb
sudo docker compose -f "$ROOT/docker-compose.w6-remote-edge.yml" -f "$ROOT/docker-compose.w10-host-b-observe.yml" \
  up -d --no-deps --force-recreate edge-gateway-b

for i in $(seq 1 40); do
  st=$(sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' proxyhubb-edge-gateway-b-1 2>/dev/null || true)
  [[ "$st" == "healthy" ]] && break
  echo "wait host-b try=$i st=$st"
  sleep 5
done
echo -n "host_b_cap="; sudo docker exec proxyhubb-edge-gateway-b-1 printenv PROXYHUB_SESSION_CAPABILITY
echo -n "host_b_bundle="; sudo docker exec proxyhubb-edge-gateway-b-1 printenv PROXYHUB_OPERATOR_BUNDLE_PATH
curl -fsS http://127.0.0.1:8090/health
echo
echo "same_org; Host-B does not count as W7.D"
echo "W10_PHASE_A_HOST_B_OK"

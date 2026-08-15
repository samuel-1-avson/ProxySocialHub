#!/usr/bin/env bash
# Wave 10.A start + W10.C auditor receipt + W10.D bundle pin on Host-A.
# Leaves PROXYHUB_SESSION_CAPABILITY=observe (does NOT restore off).
# Never arms gateway slash. Never programs/session. Not DePIN.
#
#   CONFIRM_W10_PHASE_A=1 CONFIRM_W10A_KILL_API=1 ./scripts/gcp-smoke-sprint-w10a-capability-observe.sh
set -euo pipefail
ROOT="${PROJECT_DIR:-/opt/proxyhubb}"
API="${CONTROL_API_URL:-http://127.0.0.1:18080}"
SESSION_ID="8TP21JyrghboxZqXMozx2sVzrDrNSZyN2hkf1D7dQGmb"
EDGE_HOST="${EDGE_BUYER_HOST:-127.0.0.1}"
EDGE_PORT="${EDGE_BUYER_PORT:-18091}"

echo "=== W10.A/C/D Host-A observe start ==="
if [[ "${CONFIRM_W10_PHASE_A:-}" != "1" ]]; then
  echo "REFUSE: set CONFIRM_W10_PHASE_A=1 on Host-A"
  exit 2
fi
if [[ ! -d "$ROOT" ]]; then
  echo "FAIL: $ROOT missing (run on Host-A)"
  exit 2
fi
cd "$ROOT"
if [[ "${PROXYHUB_GATEWAY_SLASH_AUTO:-}" == "1" || "${PROXYHUB_GATEWAY_SLASH_CONFIRM:-}" == "1" ]]; then
  echo "REFUSE: slash dual-gate env must stay unset"
  exit 2
fi

API_COMPOSE=(sudo docker compose
  -f "$ROOT/docker-compose.yml"
  -f "$ROOT/docker-compose.testnet.yml"
  -f "$ROOT/docker-compose.gcp-testnet.yml"
  -f "$ROOT/docker-compose.w6-host-a-private.yml"
  -f "$ROOT/docker-compose.w10-observe.yml")

EDGE_COMPOSE=(sudo docker compose
  -f "$ROOT/docker-compose.yml"
  -f "$ROOT/docker-compose.testnet.yml"
  -f "$ROOT/docker-compose.gcp-testnet.yml"
  -f "$ROOT/docker-compose.j2-multipod.yml"
  -f /tmp/w5c2-redis-override.yml
  -f "$ROOT/docker-compose.redis-ha.yml"
  -f "$ROOT/docker-compose.w6-host-a-private.yml"
  -f "$ROOT/docker-compose.w10-observe-edge.yml")

if [[ ! -f /tmp/w5c2-redis-override.yml ]]; then
  echo "FAIL: missing /tmp/w5c2-redis-override.yml (edge-b was started with it)"
  exit 2
fi
if [[ ! -f "$ROOT/docker-compose.w10-observe.yml" || ! -f "$ROOT/docker-compose.w10-observe-edge.yml" ]]; then
  echo "FAIL: missing docker-compose.w10-observe.yml or docker-compose.w10-observe-edge.yml"
  exit 2
fi

sudo mkdir -p "$ROOT/ops"
sudo chmod 755 "$ROOT/ops"

upsert_env() {
  local key="$1" val="$2"
  sudo python3 - "$ROOT/.env" "$key" "$val" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
key, val = sys.argv[2], sys.argv[3]
text = p.read_text() if p.exists() else ""
lines = [ln for ln in text.splitlines() if not ln.startswith(key + "=")]
lines.append(f"{key}={val}")
p.write_text("\n".join(lines) + "\n")
PY
}

echo "=== keys (generate on VM; values not printed) ==="
NEED_CAP=1
if sudo grep -q '^PROXYHUB_SESSION_CAPABILITY_SIGNING_KEY=.\+' "$ROOT/.env" \
  && sudo grep -q '^PROXYHUB_SESSION_CAPABILITY_ISSUER_PUBKEY=.\+' "$ROOT/.env"; then
  NEED_CAP=0
  echo "capability_keys=reuse"
fi
if [[ "$NEED_CAP" == "1" ]]; then
  if [[ -x /tmp/w7-bin/w7d-operator-join ]]; then
    /tmp/w7-bin/w7d-operator-join keygen > /tmp/w10a-cap.json
  elif command -v go >/dev/null 2>&1 && [[ -d "$ROOT/services/control-api" ]]; then
    (cd "$ROOT/services/control-api" && go run ./cmd/w7d-operator-join keygen) > /tmp/w10a-cap.json
  else
    echo "FAIL: cannot keygen (need /tmp/w7-bin/w7d-operator-join or go)"
    exit 2
  fi
  sudo python3 - <<'PY'
import json
from pathlib import Path
k=json.loads(Path("/tmp/w10a-cap.json").read_text())
assert k.get("signing_key") and k.get("pubkey"), k
env=Path("/opt/proxyhubb/.env")
text=env.read_text() if env.exists() else ""
lines=[ln for ln in text.splitlines() if not ln.startswith("PROXYHUB_SESSION_CAPABILITY_SIGNING_KEY=") and not ln.startswith("PROXYHUB_SESSION_CAPABILITY_ISSUER_PUBKEY=")]
lines.append("PROXYHUB_SESSION_CAPABILITY_SIGNING_KEY="+k["signing_key"])
lines.append("PROXYHUB_SESSION_CAPABILITY_ISSUER_PUBKEY="+k["pubkey"])
env.write_text("\n".join(lines)+"\n")
Path("/opt/proxyhubb/ops/w10a-issuer.pub").write_text(k["pubkey"]+"\n")
print("issuer_pubkey="+k["pubkey"])
print("capability_keys=generated")
PY
  shred -u /tmp/w10a-cap.json 2>/dev/null || rm -f /tmp/w10a-cap.json
else
  sudo python3 - <<'PY'
from pathlib import Path
for ln in Path("/opt/proxyhubb/.env").read_text().splitlines():
    if ln.startswith("PROXYHUB_SESSION_CAPABILITY_ISSUER_PUBKEY="):
        pub=ln.split("=",1)[1].strip()
        Path("/opt/proxyhubb/ops/w10a-issuer.pub").write_text(pub+"\n")
        print("issuer_pubkey="+pub)
        break
PY
fi

if ! sudo grep -q '^PROXYHUB_SETTLEMENT_BUNDLE_SIGNING_KEY=.\+' "$ROOT/.env"; then
  if [[ -x /tmp/w7-bin/w7d-operator-join ]]; then
    /tmp/w7-bin/w7d-operator-join keygen > /tmp/w10c-settle.json
  elif command -v go >/dev/null 2>&1; then
    (cd "$ROOT/services/control-api" && go run ./cmd/w7d-operator-join keygen) > /tmp/w10c-settle.json
  else
    echo "FAIL: cannot generate settlement signing key"
    exit 2
  fi
  sudo python3 - <<'PY'
import json
from pathlib import Path
k=json.loads(Path("/tmp/w10c-settle.json").read_text())
env=Path("/opt/proxyhubb/.env")
text=env.read_text() if env.exists() else ""
lines=[ln for ln in text.splitlines() if not ln.startswith("PROXYHUB_SETTLEMENT_BUNDLE_SIGNING_KEY=")]
lines.append("PROXYHUB_SETTLEMENT_BUNDLE_SIGNING_KEY="+k["signing_key"])
env.write_text("\n".join(lines)+"\n")
print("settlement_keys=generated")
PY
  shred -u /tmp/w10c-settle.json 2>/dev/null || rm -f /tmp/w10c-settle.json
else
  echo "settlement_keys=reuse"
fi

upsert_env PROXYHUB_SESSION_CAPABILITY observe
upsert_env PROXYHUB_OPERATOR_BUNDLE_PATH /etc/proxyhubb/operators-bundle.json
# slash dual-gates must not appear
sudo sed -i '/^PROXYHUB_GATEWAY_SLASH_/d' "$ROOT/.env"
sudo sed -i '/^PROXYHUB_SETTLEMENT_BUNDLE_AUTO=/d;/^PROXYHUB_SETTLEMENT_BUNDLE_CONFIRM=/d' "$ROOT/.env"

echo "=== pin operator bundle ==="
curl -fsS "$API/v1/gateways/operators/bundle" -o /tmp/operators-bundle.json
python3 - <<'PY'
import json
from pathlib import Path
b=json.loads(Path("/tmp/operators-bundle.json").read_text())
assert b.get("message_type")=="PROXYHUB_OPERATOR_MANIFEST_BUNDLE", b.get("message_type")
n=len(b.get("operators") or [])
assert n>=1, n
print("bundle_n="+str(n))
PY
sudo cp /tmp/operators-bundle.json "$ROOT/ops/operators-bundle.json"
sudo chmod 644 "$ROOT/ops/operators-bundle.json"
echo "W10D_BUNDLE_PINNED_FILE"

export COMPOSE_PROJECT_NAME=proxyhubb
# docker compose loads $ROOT/.env; do not source it into this shell.
unset PROXYHUB_GATEWAY_SLASH_AUTO PROXYHUB_GATEWAY_SLASH_CONFIRM || true
unset PROXYHUB_SETTLEMENT_BUNDLE_AUTO PROXYHUB_SETTLEMENT_BUNDLE_CONFIRM || true

echo "=== recreate control-api (keep w6 private overlay) ==="
"${API_COMPOSE[@]}" up -d --no-deps --force-recreate control-api

echo "=== recreate Host-A J2 edge-b ==="
"${EDGE_COMPOSE[@]}" up -d --no-deps --force-recreate edge-gateway-b

wait_ctr() {
  local name="$1" i st
  for i in $(seq 1 60); do
    st=$(sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$name" 2>/dev/null || true)
    if [[ "$st" == "healthy" ]]; then
      echo "$name healthy"
      return 0
    fi
    echo "wait $name try=$i st=$st"
    sleep 5
  done
  echo "FAIL: $name not healthy"
  sudo docker logs --tail 80 "$name" || true
  return 1
}
wait_ctr proxyhubb-control-api-1
wait_ctr proxyhubb-edge-gateway-b-1

echo -n "api_cap="; sudo docker exec proxyhubb-control-api-1 printenv PROXYHUB_SESSION_CAPABILITY
echo -n "edge_b_cap="; sudo docker exec proxyhubb-edge-gateway-b-1 printenv PROXYHUB_SESSION_CAPABILITY
echo -n "slash_auto="; sudo docker exec proxyhubb-control-api-1 printenv PROXYHUB_GATEWAY_SLASH_AUTO >/dev/null 2>&1 && echo SET || echo unset
echo -n "bundle_path_api="; sudo docker exec proxyhubb-control-api-1 printenv PROXYHUB_OPERATOR_BUNDLE_PATH
echo -n "bundle_path_edge="; sudo docker exec proxyhubb-edge-gateway-b-1 printenv PROXYHUB_OPERATOR_BUNDLE_PATH

HONESTY=$(curl -fsS "$API/v1/system/config/public")
printf '%s' "$HONESTY" | python3 -c 'import json,sys
d=json.load(sys.stdin)
g=d.get("gateway_operators") or {}
c=d.get("session_capability") or {}
s=d.get("settlement") or {}
print("session_capability_mode="+str(c.get("session_capability_mode")))
print("session_mint="+str(c.get("session_mint")))
print("remaining_spof="+str(c.get("remaining_spof")))
print("discovery_sot="+str(g.get("discovery_sot")))
print("live_economic_slash="+str(g.get("live_economic_slash")).lower())
print("operator_org_diversity="+str(g.get("operator_org_diversity")))
print("would_broadcast="+str(s.get("would_broadcast")))'
printf '%s' "$HONESTY" | python3 -c 'import json,sys
d=json.load(sys.stdin)
c=d.get("session_capability") or {}
g=d.get("gateway_operators") or {}
assert str(c.get("session_capability_mode"))=="observe", c
assert g.get("live_economic_slash") is False, g
assert str(g.get("discovery_sot")) in ("postgres_cache","bundle"), g.get("discovery_sot")
print("W10A_OBSERVE_STARTED")
print("W10D_DISCOVERY_SOT_OK")'

echo "=== W10.C settlement receipt auditor path ==="
WIN=$(sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -tAc "select window_key from settlement_manifests order by created_at desc limit 1" | tr -d '[:space:]')
[[ -n "$WIN" ]] || { echo "FAIL: no settlement_manifests"; exit 2; }
echo "window_key=$WIN"
ESCROW=$(sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -tAc "select coalesce(nullif(tx_signature,''), '') from orders where coalesce(tx_signature,'') <> '' order by updated_at desc limit 1" 2>/dev/null | tr -d '[:space:]' || true)
if [[ -z "$ESCROW" ]]; then
  ESCROW="W10C_ESCROW_QUERY_PARAM_SOAK"
  echo "escrow_tx=synthetic_query_param"
else
  echo "escrow_tx_len=${#ESCROW}"
fi
BUYER=$(sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -tAc "select id::text from profiles limit 1" | tr -d '[:space:]')
[[ -n "$BUYER" ]] || BUYER=$(sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -tAc "select id::text from settlement_manifests limit 1" | tr -d '[:space:]')
SECRET=$(sudo docker exec proxyhubb-control-api-1 sh -c 'printenv JWT_SECRET || printenv SUPABASE_JWT_SECRET' | tr -d '\r' | head -n1)
TOKEN=$(SECRET="$SECRET" USER_ID="$BUYER" python3 - <<'PY'
import os,time,hmac,hashlib,base64,json
sec=os.environ["SECRET"].encode(); uid=os.environ["USER_ID"]
b64=lambda d: base64.urlsafe_b64encode(d).rstrip(b"=").decode()
h=b64(json.dumps({"alg":"HS256","typ":"JWT"},separators=(",",":")).encode())
p=b64(json.dumps({"sub":uid,"user_id":uid,"role":"buyer","exp":int(time.time())+3600},separators=(",",":")).encode())
s=b64(hmac.new(sec,f"{h}.{p}".encode(),hashlib.sha256).digest())
print(f"{h}.{p}.{s}")
PY
)
CODE=$(curl -sS -o /tmp/w10c-receipt.json -w '%{http_code}' \
  -H "Authorization: Bearer $TOKEN" \
  "$API/v1/usage/settlement-receipts/${WIN}?escrow_tx=${ESCROW}")
echo "receipt_http=$CODE"
[[ "$CODE" == "200" ]] || { head -c 400 /tmp/w10c-receipt.json; echo; exit 2; }
python3 - <<'PY'
import json
from pathlib import Path
r=json.loads(Path("/tmp/w10c-receipt.json").read_text())
assert r.get("message_type")=="PROXYHUB_SETTLEMENT_RECEIPT", r.get("message_type")
assert r.get("signature") and r.get("issuer_pubkey"), "unsigned"
# WouldBroadcast is not on the receipt body; checked via public config + CLI later.
print("receipt_window="+r.get("window_key",""))
print("receipt_escrow_set="+str(bool(r.get("escrow_tx"))))
print("W10C_RECEIPT_EXPORT_OK")
PY
sudo cp /tmp/w10c-receipt.json "$ROOT/ops/w10c-settlement-receipt.json"
echo "W10C_AUDITOR_FILE=$ROOT/ops/w10c-settlement-receipt.json"

if [[ "${CONFIRM_W10A_KILL_API:-}" == "1" ]]; then
  echo "=== W10.A weekly kill-API CONNECT (HMAC still required in observe) ==="
  SESSION_SECRET=$(sudo docker exec proxyhubb-edge-gateway-b-1 printenv SESSION_SECRET | tr -d '\r')
  REDIS_URL=$(sudo docker exec proxyhubb-edge-gateway-b-1 printenv REDIS_URL | tr -d '\r')
  REDIS_HOST=$(python3 - <<'PY'
import os,urllib.parse
u=urllib.parse.urlparse(os.environ["U"])
print(u.hostname or "")
PY
U="$REDIS_URL")
  REDIS_CTR=proxyhubb-redis-1
  [[ "$REDIS_HOST" == "redis-replica" ]] && REDIS_CTR=proxyhubb-redis-replica-1
  PASS=$(python3 - <<'PY'
import os,urllib.parse
u=urllib.parse.urlparse(os.environ["U"])
print(u.password or "")
PY
U="$REDIS_URL")
  USER="w10a-$(python3 -c 'import uuid;print(uuid.uuid4().hex[:8])')"
  PW="w10a-pass-$(python3 -c 'import uuid;print(uuid.uuid4().hex[:8])')"
  python3 - "$USER" "$PW" "$SESSION_SECRET" <<'PY' > /tmp/w10a-session.json
import hashlib, hmac, json, os, sys, time, uuid
user, pw, secret = sys.argv[1], sys.argv[2], sys.argv[3]
order_id=str(uuid.uuid4()); session_id=str(uuid.uuid4()); buyer_id=str(uuid.uuid4()); listing_id=str(uuid.uuid4())
issued=int(time.time()); expires=issued+7200
uh=hashlib.sha256(user.encode()).hexdigest()
canonical="|".join([
  "PROXYHUB_ORDER_CREDENTIAL_V1","1",order_id,session_id,buyer_id,listing_id,uh,str(issued),str(expires)
])
payload=hashlib.sha256(canonical.encode()).hexdigest()
sig=hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
now=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
exp=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(expires))
print(json.dumps({
  "user_id": buyer_id,
  "session_id": session_id,
  "provider_id": "",
  "type": "sticky",
  "status": "active",
  "bandwidth_limit": 1073741824,
  "bandwidth_used": 0,
  "trust_tier": "verified",
  "listing_id": listing_id,
  "order_id": order_id,
  "created_at": now,
  "expires_at": exp,
  "credential_password_hash": hashlib.sha256(pw.encode()).hexdigest(),
  "credential_proof_username_hash": uh,
  "credential_proof_payload_hash": payload,
  "credential_proof_signature": sig,
  "credential_proof_issued_at": issued,
  "credential_proof_expires_at": expires,
}))
PY
  sudo docker exec "$REDIS_CTR" redis-cli -a "$PASS" --no-auth-warning SETEX "session:$USER" 600 "$(cat /tmp/w10a-session.json)" >/dev/null
  connect_code() {
    python3 - <<PY
import base64, socket
user=b"$USER"; pw=b"$PW"
token=base64.b64encode(user+b":"+pw).decode()
s=socket.create_connection(("$EDGE_HOST", int("$EDGE_PORT")), timeout=10)
req=(f"CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\nProxy-Authorization: Basic {token}\r\n\r\n").encode()
s.sendall(req)
s.settimeout(10)
data=s.recv(4096)
print(data.split(b"\r\n",1)[0].decode(errors="replace"))
s.close()
PY
  }
  UP=$(connect_code || true)
  echo "api_up_connect=$UP"
  echo "$UP" | grep -Eqi 'HTTP/1\.1 200' || { echo "FAIL: expected 200 before API stop"; exit 2; }
  sudo docker stop proxyhubb-control-api-1 >/dev/null
  sleep 2
  if curl -fsS --max-time 2 "$API/v1/system/config/public" >/dev/null 2>&1; then
    sudo docker start proxyhubb-control-api-1 >/dev/null || true
    echo "FAIL: control-api still reachable after stop"
    exit 2
  fi
  DOWN=$(connect_code || true)
  echo "api_down_connect=$DOWN"
  sudo docker start proxyhubb-control-api-1 >/dev/null
  wait_ctr proxyhubb-control-api-1
  echo "$DOWN" | grep -Eqi 'HTTP/1\.1 200' || { echo "FAIL: expected 200 with API down"; exit 2; }
  echo "W10A_KILL_API_CONNECT_OK"
  rm -f /tmp/w10a-session.json
else
  echo "W10A_KILL_API_SKIPPED (set CONFIRM_W10A_KILL_API=1)"
fi

echo "observe_started_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "observe_decision_due_utc=$(date -u -d '+7 days' +%Y-%m-%dT%H:%M:%SZ)"
echo "next_kill_api_due_utc=$(date -u -d '+7 days' +%Y-%m-%dT%H:%M:%SZ)"
echo "mode left observe; slash gates off; listing off; not DePIN"
echo "W10_PHASE_A_HOST_A_OK"

#!/usr/bin/env bash
# Fix funder BOM, run KEEP_ORDER smoke, inspect Redis with password, retry CONNECT.
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

# Strip UTF-8 BOM from staged funder if present
python3 - <<'PY'
from pathlib import Path
p=Path('/tmp/smoke-funder.json')
raw=p.read_bytes()
if raw.startswith(b'\xef\xbb\xbf'):
  raw=raw[3:]
  p.write_bytes(raw)
  print('stripped_bom')
import json
d=json.loads(raw)
assert isinstance(d,list) and len(d)==64
print('funder_ok len', len(d))
PY

export LISTING_ID=c1472dbc-dee3-407e-8fea-ec3ed42489ac
export NODE_ID=4b60f9e2-11dc-4240-a332-6ec9f3669379
export HOLD_RELEASE=1
export REQUIRE_CONNECT=0
export SKIP_NODE_SOFT_DELETE=1
export KEEP_ORDER=1
export ORACLE_KP=/tmp/smoke-funder.json

"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "UPDATE provider_nodes SET deleted_at=NULL, status='online', is_healthy=true, last_seen_at=NOW() WHERE id='$NODE_ID';" >/dev/null
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "UPDATE proxy_listings SET provider_node_id='$NODE_ID', status='active', updated_at=NOW() WHERE id='$LISTING_ID';" >/dev/null

# Ensure smoke script has KEEP_ORDER / no funder delete
cp /tmp/gcp-smoke-marketplace-escrow-buy.sh scripts/gcp-smoke-marketplace-escrow-buy.sh 2>/dev/null || true
sed -i 's/\r$//' scripts/gcp-smoke-marketplace-escrow-buy.sh

set +e
bash scripts/gcp-smoke-marketplace-escrow-buy.sh >/tmp/keep-order-smoke.log 2>&1
RC=$?
set -e
tail -n 80 /tmp/keep-order-smoke.log
OID=$(grep -E '^oid=' /tmp/keep-order-smoke.log | tail -1 | cut -d= -f2 || true)
echo "OID=$OID smoke_rc=$RC"
[[ -n "$OID" ]] || exit 1

USER=$(python3 -c 'import json;d=json.load(open("/tmp/cred.json"));c=d.get("proxy_credentials")or d;print(c.get("username")or"")')
PASS=$(python3 -c 'import json;d=json.load(open("/tmp/cred.json"));c=d.get("proxy_credentials")or d;print(c.get("password")or"")')
echo "user=$USER pass_len=${#PASS}"

REDIS_URL=$("${COMPOSE[@]}" exec -T control-api printenv REDIS_URL | tr -d '\r')
REDIS_PASSWORD=$("${COMPOSE[@]}" exec -T control-api printenv REDIS_PASSWORD | tr -d '\r' || true)
echo "redis_url_host=$(echo "$REDIS_URL" | sed -E 's#.*@([^/]+).*#\1#;s#redis://##')"

# Prefer redis-cli -a inside redis container
RAW=""
if [[ -n "$REDIS_PASSWORD" ]]; then
  RAW=$("${COMPOSE[@]}" exec -T redis redis-cli -a "$REDIS_PASSWORD" --no-auth-warning GET "session:$USER" | tr -d '\r')
else
  RAW=$("${COMPOSE[@]}" exec -T redis redis-cli GET "session:$USER" | tr -d '\r')
fi
echo "redis_raw_len=${#RAW}"
echo "$RAW" | head -c 700; echo

python3 - <<PY
import hashlib, json
raw = """$RAW"""
pwd = """$PASS"""
print("sha256(api_pass)=", hashlib.sha256(pwd.encode()).hexdigest())
if not raw or raw == "(nil)" or raw.startswith("NOAUTH"):
    print("REDIS_MISSING_OR_AUTH", raw[:80]); raise SystemExit
d=json.loads(raw)
h=d.get("credential_password_hash","")
print("redis_hash=", h)
print("match=", h == hashlib.sha256(pwd.encode()).hexdigest())
print("node_id=", d.get("node_id"))
print("status=", d.get("status"))
print("bw_limit=", d.get("bandwidth_limit"), "bw_used=", d.get("bandwidth_used"))
print("session_id=", d.get("session_id"))
PY

echo "=== DB session status ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT s.id, s.status FROM sessions s JOIN orders o ON o.session_id=s.id WHERE o.id='$OID';"

echo "=== CONNECT ==="
set +e
curl -sS --max-time 25 -x "http://${USER}:${PASS}@127.0.0.1:8090" https://example.com \
  -o /tmp/cbody -w 'connect_http=%{http_code}\n' 2>/tmp/cerr
echo curl_rc=$?
cat /tmp/cerr | tail -20
head -c 200 /tmp/cbody; echo
set -e
docker logs proxyhubb-edge-gateway-1 --since 2m 2>&1 | grep -iE "$USER|Invalid|authenticated|Pinned|no provider|407" | tail -20

echo KEEP_REDIS_DIAG_DONE

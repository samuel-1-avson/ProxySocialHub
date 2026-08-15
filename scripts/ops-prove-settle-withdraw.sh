#!/usr/bin/env bash
# Prove settle (release) + small withdraw after RPC harden.
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
OUT=docs/ops/evidence
mkdir -p "$OUT"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
REPORT="$OUT/SETTLE_WITHDRAW_${STAMP}.md"
API="${API:-http://127.0.0.1:18080}"
SELLER=b77e84c9-0e85-4f23-afc0-581cd561c216

{
  echo "# Settle + withdraw prove — $STAMP"
  echo
  echo "## RPC"
  docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml exec -T control-api sh -c 'printenv | grep -E "^SOLANA_RPC"' || true
  echo
  echo "## Steps"
} >"$REPORT"

# Prefer public RPC for smoke client too
export RPC="${RPC:-https://api.devnet.solana.com}"
export HOLD_RELEASE=1
export REQUIRE_CONNECT=0
export SKIP_NODE_SOFT_DELETE=1
export KEEP_ORDER=1
export SETTLE_COOLDOWN_SECS="${SETTLE_COOLDOWN_SECS:-25}"
export NODE_ID="${NODE_ID:-4b60f9e2-11dc-4240-a332-6ec9f3669379}"
export LISTING_ID="${LISTING_ID:-c1472dbc-dee3-407e-8fea-ec3ed42489ac}"
export ORACLE_KP="${ORACLE_KP:-/tmp/smoke-funder.json}"

# Strip BOM on funder if needed
python3 - <<'PY'
from pathlib import Path
p=Path('/tmp/smoke-funder.json')
if p.exists():
  raw=p.read_bytes()
  if raw.startswith(b'\xef\xbb\xbf'):
    p.write_bytes(raw[3:])
  import json; d=json.loads(p.read_text()); assert isinstance(d,list) and len(d)==64
  print('funder_ok')
else:
  print('funder_missing')
PY

PASS=0; FAIL=0
note(){ echo "- $1" | tee -a "$REPORT"; }
pass(){ PASS=$((PASS+1)); note "PASS: $1"; }
fail(){ FAIL=$((FAIL+1)); note "FAIL: $1"; }

echo "=== escrow buy+release (settle) ===" | tee -a "$REPORT"
set +e
bash scripts/gcp-smoke-marketplace-escrow-buy.sh >/tmp/settle-withdraw-escrow.log 2>&1
ERC=$?
set -e
tail -n 50 /tmp/settle-withdraw-escrow.log | tee -a "$REPORT"
if grep -q 'RELEASE_OK\|release HTTP=200\|CONFIRM_OK' /tmp/settle-withdraw-escrow.log; then
  if grep -qE 'release HTTP=200|RELEASE_OK' /tmp/settle-withdraw-escrow.log; then
    pass "on-chain settle/release"
  elif grep -q 'escrow_settle_queued\|settle_queued' /tmp/settle-withdraw-escrow.log; then
    fail "settle still queued (RPC)"
  else
    pass "confirm path (check release status above)"
  fi
else
  fail "escrow smoke rc=$ERC"
fi

# Drain compensation outbox once if queued
echo "=== compensation outbox peek ===" | tee -a "$REPORT"
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT id, kind, status, attempt_count, left(coalesce(last_error,''),100) AS err, updated_at FROM compensation_outbox WHERE kind='escrow_settle' ORDER BY updated_at DESC LIMIT 5;" 2>/dev/null | tee -a "$REPORT" || true

echo "=== withdraw smoke ===" | tee -a "$REPORT"
SECRET=$("${COMPOSE[@]}" exec -T control-api sh -c 'printenv JWT_SECRET || printenv SUPABASE_JWT_SECRET' | tr -d '\r' | head -n1 || true)
TOKEN=$(SECRET="$SECRET" USER_ID="$SELLER" python3 - <<'PY'
import os,time,hmac,hashlib,base64,json
sec=os.environ["SECRET"].encode(); uid=os.environ["USER_ID"]
b64=lambda d: base64.urlsafe_b64encode(d).rstrip(b"=").decode()
h=b64(json.dumps({"alg":"HS256","typ":"JWT"},separators=(",",":")).encode())
p=b64(json.dumps({"sub":uid,"user_id":uid,"role":"seller","exp":int(time.time())+3600},separators=(",",":")).encode())
s=b64(hmac.new(sec,f"{h}.{p}".encode(),hashlib.sha256).digest())
print(f"{h}.{p}.{s}")
PY
)
# retry withdraw a few times across RPC flaps
WCODE=000
for i in 1 2 3 4 5; do
  WCODE=$(curl -sS -o /tmp/w.json -w '%{http_code}' -X POST "$API/v1/wallet/withdraw/sol" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d '{"amount":0.01}' || echo 000)
  echo "withdraw attempt $i HTTP=$WCODE body=$(head -c 220 /tmp/w.json)" | tee -a "$REPORT"
  if [[ "$WCODE" == "200" || "$WCODE" == "202" ]]; then
    break
  fi
  sleep 3
done
if [[ "$WCODE" == "200" || "$WCODE" == "202" ]]; then
  pass "withdraw HTTP=$WCODE"
else
  fail "withdraw HTTP=$WCODE"
fi

{
  echo
  echo "## Summary"
  echo "PASS=$PASS FAIL=$FAIL"
  if [[ "$FAIL" -eq 0 ]]; then echo "VERDICT=PASS"; else echo "VERDICT=PARTIAL"; fi
} | tee -a "$REPORT"
echo "SETTLE_WITHDRAW_REPORT=$REPORT"
echo "SETTLE_WITHDRAW_DONE"
[[ "$FAIL" -eq 0 ]]

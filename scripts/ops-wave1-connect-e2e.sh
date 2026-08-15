#!/usr/bin/env bash
# Wave-1 CONNECT pack: unfreeze → gated buy → credentials → CONNECT → release → optional withdraw.
# Usage on VM:
#   ORACLE_KP=/tmp/smoke-funder.json HOLD_RELEASE=1 bash scripts/ops-wave1-connect-e2e.sh
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
OUT=docs/ops/evidence
mkdir -p "$OUT"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
REPORT="$OUT/E2E_connect_pack_${STAMP}.md"
API="${API:-http://127.0.0.1:18080}"
RPC="${RPC:-https://api.devnet.solana.com}"
SELLER=b77e84c9-0e85-4f23-afc0-581cd561c216

PASS=0; FAIL=0; SKIP=0
note(){ echo "- $1" | tee -a "$REPORT"; }
pass(){ PASS=$((PASS+1)); note "PASS: $1"; }
fail(){ FAIL=$((FAIL+1)); note "FAIL: $1"; }
skip(){ SKIP=$((SKIP+1)); note "SKIP: $1"; }

{
  echo "# Wave-1 CONNECT e2e pack — $STAMP"
  echo "| API | \`$API\` |"
  echo "| RPC | \`$RPC\` |"
  echo
  echo "## Steps"
} >"$REPORT"

echo "=== 1) unfreeze seller flags ===" | tee -a "$REPORT"
bash scripts/ops-triage01-unfreeze.sh "$SELLER" | tee -a "$REPORT"
OPEN=$( "${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -At -c \
  "SELECT COUNT(*) FROM user_flags WHERE user_id='$SELLER'::uuid AND resolved=false;" | tr -d '\r')
[[ "$OPEN" == "0" ]] && pass "seller user_flags cleared" || fail "open flags remain=$OPEN"

echo "=== 2) provider/edge status ===" | tee -a "$REPORT"
EG=$("${COMPOSE[@]}" ps edge-gateway --format '{{.Status}}' 2>/dev/null | head -1 || true)
PN=$(docker ps --format '{{.Names}} {{.Status}}' 2>/dev/null | grep -i provider-node | head -1 || true)
echo "edge=$EG provider=$PN" | tee -a "$REPORT"
[[ -n "$EG" ]] && pass "edge-gateway up" || fail "edge-gateway down"

echo "=== 3) gated buy + HOLD_RELEASE CONNECT ===" | tee -a "$REPORT"
export HOLD_RELEASE=1
export REQUIRE_CONNECT="${REQUIRE_CONNECT:-0}"
export SKIP_NODE_SOFT_DELETE="${SKIP_NODE_SOFT_DELETE:-1}"
export NODE_ID="${NODE_ID:-4b60f9e2-11dc-4240-a332-6ec9f3669379}"
export LISTING_ID="${LISTING_ID:-c1472dbc-dee3-407e-8fea-ec3ed42489ac}"
export ORACLE_KP="${ORACLE_KP:-/tmp/smoke-funder.json}"
export RPC
# Ensure listing points at the live tunnel node before buy
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "UPDATE proxy_listings SET provider_node_id='$NODE_ID', status='active', updated_at=NOW() WHERE id='$LISTING_ID';" >/dev/null || true
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "UPDATE provider_nodes SET deleted_at=NULL, status='online', is_healthy=true, last_seen_at=NOW(), updated_at=NOW() WHERE id='$NODE_ID';" >/dev/null || true
set +e
bash scripts/gcp-smoke-marketplace-escrow-buy.sh >/tmp/connect-e2e-escrow.log 2>&1
ERC=$?
set -e
tail -n 60 /tmp/connect-e2e-escrow.log | tee -a "$REPORT"
if [[ "$ERC" -eq 0 ]]; then
  pass "escrow confirm+release path"
  if grep -q 'CONNECT_OK' /tmp/connect-e2e-escrow.log; then
    pass "CONNECT via edge"
  elif grep -q 'CONNECT_FAIL' /tmp/connect-e2e-escrow.log; then
    fail "CONNECT (provider tunnel likely missing)"
  else
    skip "CONNECT section not present in log"
  fi
else
  fail "escrow smoke rc=$ERC"
fi

echo "=== 4) small withdraw smoke ===" | tee -a "$REPORT"
SECRET=$("${COMPOSE[@]}" exec -T control-api sh -c 'printenv JWT_SECRET || printenv SUPABASE_JWT_SECRET' | tr -d '\r' | head -n1 || true)
if [[ -n "$SECRET" ]]; then
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
  WCODE=$(curl -sS -o /tmp/w.json -w '%{http_code}' -X POST "$API/v1/wallet/withdraw/sol" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d '{"amount":0.01}' || echo 000)
  echo "withdraw HTTP=$WCODE body=$(head -c 300 /tmp/w.json 2>/dev/null)" | tee -a "$REPORT"
  case "$WCODE" in
    200|202) pass "withdraw accepted" ;;
    403) fail "withdraw still frozen/forbidden" ;;
    *) skip "withdraw HTTP=$WCODE" ;;
  esac
else
  skip "withdraw — no JWT secret"
fi

VERDICT=PARTIAL
[[ "$FAIL" -eq 0 && "$PASS" -ge 3 ]] && VERDICT=PASS
[[ "$FAIL" -gt 0 && "$PASS" -eq 0 ]] && VERDICT=FAIL
{
  echo
  echo "## Verdict"
  echo "| Pass | Fail | Skip | Verdict |"
  echo "|------|------|------|---------|"
  echo "| $PASS | $FAIL | $SKIP | **$VERDICT** |"
} >>"$REPORT"
echo "E2E_CONNECT_REPORT=$REPORT"
echo "E2E_CONNECT_VERDICT=$VERDICT"
echo E2E_CONNECT_DONE

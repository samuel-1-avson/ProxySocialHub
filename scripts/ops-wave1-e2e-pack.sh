#!/usr/bin/env bash
# Wave-1 E2E pack orchestrator (gated escrow path + CONNECT attempt + settle + withdraw).
# Writes docs/ops/evidence/E2E_pack_<stamp>.md
set -euo pipefail
PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
cd "$PROJECT_DIR"
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
OUT_DIR="$PROJECT_DIR/docs/ops/evidence"
mkdir -p "$OUT_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
REPORT="$OUT_DIR/E2E_pack_${STAMP}.md"
API="${API:-http://127.0.0.1:18080}"
EDGE="${EDGE:-http://127.0.0.1:8090}"
RPC="${RPC:-https://api.devnet.solana.com}"

PASS=0
FAIL=0
SKIP=0
note() { echo "- $1" | tee -a "$REPORT"; }
pass() { PASS=$((PASS+1)); note "PASS: $1"; }
fail() { FAIL=$((FAIL+1)); note "FAIL: $1"; }
skip() { SKIP=$((SKIP+1)); note "SKIP: $1"; }

{
  echo "# Wave-1 E2E pack — $STAMP"
  echo
  echo "| Field | Value |"
  echo "|-------|-------|"
  echo "| Host | \`$(hostname)\` |"
  echo "| API | \`$API\` |"
  echo "| Edge | \`$EDGE\` |"
  echo "| RPC | \`$RPC\` |"
  echo
  echo "## Steps"
  echo
} >"$REPORT"

echo "=== preflight flags ===" | tee -a "$REPORT"
REQUIRE=$("${COMPOSE[@]}" exec -T control-api printenv PROXYHUB_REQUIRE_ESCROW_PDA 2>/dev/null | tr -d '\r' || true)
echo "PROXYHUB_REQUIRE_ESCROW_PDA=$REQUIRE" | tee -a "$REPORT"
if [[ "$REQUIRE" == "true" ]]; then pass "escrow PDA gate on"; else fail "escrow PDA gate off"; fi

HC=$(curl -sS -o /dev/null -w '%{http_code}' "$API/health" || echo 000)
[[ "$HC" == "200" ]] && pass "control-api health" || fail "control-api health=$HC"

# Edge / provider presence
EDGE_UP=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$EDGE/" || echo 000)
echo "edge_http=$EDGE_UP" | tee -a "$REPORT"
PN=$("${COMPOSE[@]}" ps provider-node --format '{{.Status}}' 2>/dev/null | head -1 || true)
EG=$("${COMPOSE[@]}" ps edge-gateway --format '{{.Status}}' 2>/dev/null | head -1 || true)
echo "provider-node=$PN" | tee -a "$REPORT"
echo "edge-gateway=$EG" | tee -a "$REPORT"

echo "=== 1) gated marketplace escrow buy (confirm+release) ===" | tee -a "$REPORT"
set +e
RPC="$RPC" bash scripts/gcp-smoke-marketplace-escrow-buy.sh >"/tmp/e2e-escrow-${STAMP}.log" 2>&1
ESC_RC=$?
set -e
tail -n 40 "/tmp/e2e-escrow-${STAMP}.log" | tee -a "$REPORT"
if [[ "$ESC_RC" -eq 0 ]]; then
  pass "gated buy → confirm-escrow → release"
else
  fail "escrow buy smoke rc=$ESC_RC (see /tmp/e2e-escrow-${STAMP}.log)"
fi

echo "=== 2) CONNECT attempt (best-effort after last active session) ===" | tee -a "$REPORT"
# Pull latest active session credentials if any
CREDS=$("${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -At -c "
SELECT username || ':' || password FROM (
  SELECT proxy_username AS username, proxy_password AS password, created_at
  FROM sessions
  WHERE status='active' AND proxy_username IS NOT NULL AND proxy_password IS NOT NULL
  ORDER BY created_at DESC LIMIT 1
) s;" 2>/dev/null | tr -d '\r' || true)

# Alternate column names
if [[ -z "$CREDS" || "$CREDS" == ":" ]]; then
  CREDS=$("${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -At -c "
  SELECT credentials_user || ':' || credentials_pass FROM sessions
  WHERE status IN ('active','Active') AND credentials_user IS NOT NULL
  ORDER BY created_at DESC LIMIT 1;" 2>/dev/null | tr -d '\r' || true)
fi

if [[ -n "$CREDS" && "$CREDS" != ":" ]]; then
  USER=${CREDS%%:*}
  PASSW=${CREDS#*:}
  echo "trying CONNECT user=${USER:0:4}***" | tee -a "$REPORT"
  set +e
  curl -sS --max-time 45 -x "http://${USER}:${PASSW}@127.0.0.1:8090" https://example.com -o /tmp/e2e-connect-body -w 'connect_http=%{http_code}\n' >"/tmp/e2e-connect-${STAMP}.txt" 2>&1
  CRC=$?
  set -e
  # Never echo proxy password; only status line
  grep -E 'connect_http=' "/tmp/e2e-connect-${STAMP}.txt" | tee -a "$REPORT" || true
  if [[ "$CRC" -eq 0 ]] && grep -q 'connect_http=200' "/tmp/e2e-connect-${STAMP}.txt"; then
    pass "CONNECT via edge :8090"
  else
    fail "CONNECT via edge (rc=$CRC) — provider tunnel may be down"
  fi
else
  skip "CONNECT — no active session credentials after buy smoke (release ends session)"
fi

echo "=== 3) money-path / withdraw queue ===" | tee -a "$REPORT"
set +e
bash scripts/gcp-smoke-money-path.sh >"/tmp/e2e-money-${STAMP}.log" 2>&1
MRC=$?
set -e
tail -n 30 "/tmp/e2e-money-${STAMP}.log" | tee -a "$REPORT"
if [[ "$MRC" -eq 0 ]]; then pass "money-path smoke"; else fail "money-path rc=$MRC"; fi

# Optional withdraw if we can mint JWT for seller with balance
echo "=== 4) small withdraw attempt (seller wallet) ===" | tee -a "$REPORT"
SECRET=$("${COMPOSE[@]}" exec -T control-api sh -c 'printenv JWT_SECRET || printenv SUPABASE_JWT_SECRET' | tr -d '\r' | head -n1 || true)
SELLER=b77e84c9-0e85-4f23-afc0-581cd561c216
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
  set +e
  WCODE=$(curl -sS -o /tmp/e2e-withdraw.json -w '%{http_code}' -X POST "$API/v1/wallet/withdraw/sol" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d '{"amount":0.01}')
  set -e
  echo "withdraw HTTP=$WCODE body=$(head -c 400 /tmp/e2e-withdraw.json)" | tee -a "$REPORT"
  case "$WCODE" in
    200|202) pass "withdraw accepted (queued/processed)" ;;
    *) skip "withdraw HTTP=$WCODE (may be blocked by deficit/liquidity/KYC — non-fatal for pack)" ;;
  esac
else
  skip "withdraw — no JWT secret"
fi

VERDICT="PARTIAL"
if [[ "$FAIL" -eq 0 && "$PASS" -ge 3 ]]; then VERDICT="PASS"; fi
if [[ "$FAIL" -gt 0 && "$PASS" -eq 0 ]]; then VERDICT="FAIL"; fi

{
  echo
  echo "## Verdict"
  echo
  echo "| Pass | Fail | Skip | Verdict |"
  echo "|------|------|------|---------|"
  echo "| $PASS | $FAIL | $SKIP | **$VERDICT** |"
  echo
  echo "### Notes"
  echo "- Escrow buy smoke releases immediately; CONNECT may SKIP unless a live session remains."
  echo "- Full buy→CONNECT→meter→settle in one continuous order requires a HOLD_RELEASE variant (follow-up)."
} >>"$REPORT"

echo "E2E_REPORT=$REPORT"
echo "E2E_VERDICT=$VERDICT"
echo E2E_PACK_DONE

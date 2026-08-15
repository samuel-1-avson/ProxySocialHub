#!/usr/bin/env bash
# M1: product load (k6) vs live Testnet public URLs.
# Runs grafana/k6 in Docker on the VM; targets https://api.proxyhubb.com by default
# so traffic still traverses Caddy/public path.
#
# Usage (on VM):
#   bash scripts/ops-m1-product-load.sh
#   SKIP_CONNECT=1 bash scripts/ops-m1-product-load.sh
#   API_BASE=https://api.proxyhubb.com bash scripts/ops-m1-product-load.sh
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

API_BASE="${API_BASE:-https://api.proxyhubb.com}"
PROXY_HOST="${PROXY_HOST:-proxy.proxyhubb.com:8090}"
SKIP_CONNECT="${SKIP_CONNECT:-0}"
BUYER_ID="${BUYER_ID:-76609a25-0b69-4e05-9640-4c67d7a07f36}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${OUT_DIR:-/opt/proxyhubb/docs/ops/evidence}"
mkdir -p "$OUT_DIR" /tmp/m1-k6
SUMMARY_JSON="/tmp/m1-k6/summary-${STAMP}.json"
SUMMARY_TXT="/tmp/m1-k6/summary-${STAMP}.txt"
EVIDENCE="${OUT_DIR}/M1_product_load_${STAMP}.md"

echo "=== M1 product load ==="
echo "api_base=$API_BASE stamp=$STAMP"

echo "=== mint buyer JWT ==="
SECRET=$("${COMPOSE[@]}" exec -T control-api sh -c 'printenv JWT_SECRET || printenv SUPABASE_JWT_SECRET' | tr -d '\r' | head -n1)
[[ -n "$SECRET" ]] || { echo "FATAL: no JWT secret"; exit 2; }
BUYER_JWT=$(SECRET="$SECRET" USER_ID="$BUYER_ID" python3 - <<'PY'
import os,time,hmac,hashlib,base64,json
sec=os.environ["SECRET"].encode(); uid=os.environ["USER_ID"]
b64=lambda d: base64.urlsafe_b64encode(d).rstrip(b"=").decode()
h=b64(json.dumps({"alg":"HS256","typ":"JWT"},separators=(",",":")).encode())
p=b64(json.dumps({"sub":uid,"user_id":uid,"role":"buyer","exp":int(time.time())+7200},separators=(",",":")).encode())
s=b64(hmac.new(sec,f"{h}.{p}".encode(),hashlib.sha256).digest())
print(f"{h}.{p}.{s}")
PY
)
echo "buyer_jwt_len=${#BUYER_JWT}"

PROXY_USER=""
PROXY_PASS=""
if [[ "$SKIP_CONNECT" != "1" ]]; then
  echo "=== resolve active session creds (optional CONNECT) ==="
  # Prefer a recent active session for the buyer with plaintext-capable decrypt path via API.
  # Fall back: skip CONNECT if none.
  CREDS_JSON=$(SECRET="$SECRET" BUYER_ID="$BUYER_ID" API="$API_BASE" JWT="$BUYER_JWT" python3 - <<'PY' || true
import json, os, urllib.request
api=os.environ["API"].rstrip("/")
jwt=os.environ["JWT"]
req=urllib.request.Request(f"{api}/v1/sessions?limit=20&status=active", headers={"Authorization": f"Bearer {jwt}"})
try:
    with urllib.request.urlopen(req, timeout=20) as r:
        d=json.loads(r.read().decode())
except Exception as e:
    print(json.dumps({"error": str(e)}))
    raise SystemExit(0)
sessions=d.get("sessions") or d.get("data") or d.get("items") or []
if isinstance(d, list):
    sessions=d
print(json.dumps({"count": len(sessions), "sample_keys": list((sessions[0] if sessions else {}).keys())[:12]}))
PY
  )
  echo "sessions_probe=$CREDS_JSON"
  # CONNECT optional for M1 floor — full CONNECT soak is separate. Skip unless PROXY_USER preset.
  if [[ -z "${PROXY_USER:-}" || -z "${PROXY_PASS:-}" ]]; then
    echo "CONNECT: skipped (no PROXY_USER/PASS; public+auth load still runs)"
    PROXY_HOST=""
  fi
fi

echo "=== preflight public ==="
for path in /health /v1/health/system /v1/listings?limit=5 /v1/system/config/public; do
  code=$(curl -sS -m 15 -o /dev/null -w '%{http_code}' "${API_BASE}${path}" || echo 000)
  echo "preflight ${path} -> ${code}"
done

echo "=== pull k6 image ==="
docker pull grafana/k6:0.54.0 >/tmp/m1-k6/pull.log 2>&1 || docker pull grafana/k6:latest >/tmp/m1-k6/pull.log 2>&1
K6_IMAGE=$(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^grafana/k6:' | head -1)
[[ -n "$K6_IMAGE" ]] || { echo "FATAL: no k6 image"; exit 2; }
echo "k6_image=$K6_IMAGE"

# Copy script into a bind-friendly path (k6 container user must write summary)
cp -f testing/product_load.k6.js /tmp/m1-k6/product_load.k6.js
chmod -R a+rwX /tmp/m1-k6

echo "=== run k6 ==="
set +e
docker run --rm \
  -e API_BASE="$API_BASE" \
  -e BUYER_JWT="$BUYER_JWT" \
  -e PROXY_HOST="${PROXY_HOST}" \
  -e PROXY_USER="${PROXY_USER}" \
  -e PROXY_PASS="${PROXY_PASS}" \
  -u "$(id -u):$(id -g)" \
  -v /tmp/m1-k6:/scripts \
  "$K6_IMAGE" run \
  --summary-export=/scripts/summary-${STAMP}.json \
  /scripts/product_load.k6.js | tee "$SUMMARY_TXT"
RC=${PIPESTATUS[0]}
set -e

echo "k6_exit=$RC"

# Parse key thresholds from summary if present
export M1_STAMP="$STAMP" M1_RC="$RC" M1_API="$API_BASE" M1_BUYER="$BUYER_ID"
export M1_SUMMARY_JSON="$SUMMARY_JSON" M1_SUMMARY_TXT="$SUMMARY_TXT" M1_EVIDENCE="$EVIDENCE"
python3 - <<'PY'
import json, os, pathlib
stamp = os.environ["M1_STAMP"]
rc = int(os.environ["M1_RC"])
api = os.environ["M1_API"]
buyer = os.environ["M1_BUYER"]
summary_path = pathlib.Path(os.environ["M1_SUMMARY_JSON"])
ev_path = pathlib.Path(os.environ["M1_EVIDENCE"])

def metric_val(m, name, key):
    x = m.get(name) or {}
    vals = x.get("values") or x
    return vals.get(key)

http_fail = browse_p95 = product_err = http_p95 = iters = None
if summary_path.exists():
    j = json.loads(summary_path.read_text())
    m = j.get("metrics") or {}
    http_fail = metric_val(m, "http_req_failed", "rate")
    browse_p95 = metric_val(m, "browse_latency_ms", "p(95)")
    product_err = metric_val(m, "product_errors", "rate")
    http_p95 = metric_val(m, "http_req_duration", "p(95)")
    iters = metric_val(m, "iterations", "count")

verdict = "M1_PASS" if rc == 0 else "M1_FAIL"
lines = [
    f"# M1 product load vs live — {verdict}",
    "",
    f"**When:** {stamp}",
    f"**API_BASE:** `{api}`",
    "**Runner:** grafana/k6 in Docker on `proxyhubb-testnet` (targets public URL)",
    f"**k6 exit:** {rc}",
    f"**Buyer:** `{buyer}` (JWT minted on-box)",
    "**CONNECT scenario:** skipped unless PROXY_USER/PASS provided",
    "",
    "## SLO thresholds (from testing/product_load.k6.js)",
    "",
    "- `http_req_failed` rate < 5%",
    "- `browse_latency_ms` p95 < 2000ms",
    "- `product_errors` rate < 5%",
    "",
    "## Observed",
    "",
    "| Metric | Value |",
    "|--------|------:|",
    f"| http_req_failed rate | {http_fail} |",
    f"| browse_latency_ms p95 | {browse_p95} |",
    f"| product_errors rate | {product_err} |",
    f"| http_req_duration p95 | {http_p95} |",
    f"| iterations | {iters} |",
    "",
    "## Scenarios",
    "",
    "- public_browse: ramp to 15 arrivals/s (~3m)",
    "- authenticated: 3/s for 2m (wallet/orders/usage/sessions)",
    "- connect_smoke: optional",
    "",
    f"**Verdict:** `{verdict}`",
    "",
    "Raw: `/tmp/m1-k6/summary-*.json` + `summary-*.txt` on VM.",
]
ev_path.write_text("\n".join(lines) + "\n")
print("evidence", ev_path)
print(verdict)
PY

# Also copy summary into evidence dir if present
[[ -f "$SUMMARY_JSON" ]] && cp -f "$SUMMARY_JSON" "$OUT_DIR/M1_product_load_${STAMP}.summary.json" || true
cp -f "$SUMMARY_TXT" "$OUT_DIR/M1_product_load_${STAMP}.log.txt" || true

echo "EVIDENCE=$EVIDENCE"
exit "$RC"

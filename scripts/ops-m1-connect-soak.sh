#!/usr/bin/env bash
# CONNECT load soak vs live edge.
# Provisions a held escrow order for credentials, then hammers CONNECT for DURATION.
#
# Usage (on VM):
#   bash scripts/ops-m1-connect-soak.sh
#   CONCURRENCY=10 DURATION_SECS=120 bash scripts/ops-m1-connect-soak.sh
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${OUT_DIR:-/opt/proxyhubb/docs/ops/evidence}"
mkdir -p "$OUT_DIR" /tmp/m1-connect
EVIDENCE="${OUT_DIR}/M1_CONNECT_soak_${STAMP}.md"
LOG="/tmp/m1-connect/soak-${STAMP}.log"
PROV_LOG="/tmp/m1-connect/provision-${STAMP}.log"

# Prefer public edge for realism; allow override to loopback.
PROXY_HOST="${PROXY_HOST:-proxy.proxyhubb.com:8090}"
# Cap concurrency — edge session is single-credential; 8 was fine for health, too hot for one session.
CONCURRENCY="${CONCURRENCY:-4}"
DURATION_SECS="${DURATION_SECS:-90}"
TARGET_URL="${TARGET_URL:-https://api.proxyhubb.com/health}"
BUYER_ID="${BUYER_ID:-76609a25-0b69-4e05-9640-4c67d7a07f36}"
# Pace requests so a single session does not look like a scrape (example.com returns curl 56 under burst).
PACING_MS="${PACING_MS:-50}"
MAX_INFLIGHT="${MAX_INFLIGHT:-$CONCURRENCY}"

LISTING_ID="${LISTING_ID:-c1472dbc-dee3-407e-8fea-ec3ed42489ac}"
NODE_ID="${NODE_ID:-4b60f9e2-11dc-4240-a332-6ec9f3669379}"
API="${API:-https://api.proxyhubb.com}"

echo "=== CONNECT soak ==="
echo "proxy_host=$PROXY_HOST concurrency=$CONCURRENCY duration=${DURATION_SECS}s stamp=$STAMP"

SECRET=$("${COMPOSE[@]}" exec -T control-api sh -c 'printenv JWT_SECRET || printenv SUPABASE_JWT_SECRET' | tr -d '\r' | head -n1)
BUYER_JWT=$(SECRET="$SECRET" USER_ID="$BUYER_ID" python3 - <<'PY'
import os, time, hmac, hashlib, base64, json
sec = os.environ["SECRET"].encode()
uid = os.environ["USER_ID"]
b64 = lambda d: base64.urlsafe_b64encode(d).rstrip(b"=").decode()
h = b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
p = b64(json.dumps({"sub": uid, "user_id": uid, "role": "buyer", "exp": int(time.time()) + 7200}, separators=(",", ":")).encode())
s = b64(hmac.new(sec, f"{h}.{p}".encode(), hashlib.sha256).digest())
print(f"{h}.{p}.{s}")
PY
)

echo "=== provision credentials (HOLD_RELEASE smoke) ==="
export HOLD_RELEASE=1 REQUIRE_CONNECT=1 SKIP_NODE_SOFT_DELETE=1 KEEP_ORDER=1 KEEP_LISTING=1
export SKIP_RELEASE=1
export SETTLE_COOLDOWN_SECS=5
export NODE_ID LISTING_ID
export ORACLE_KP="${ORACLE_KP:-/tmp/smoke-funder.json}"
if [[ -z "${RPC:-}" ]]; then
  RPC=$(grep -E '^SOLANA_RPC_ENDPOINT=' .env | head -1 | cut -d= -f2- | tr -d '\r' || true)
fi
export RPC
set +e
bash scripts/gcp-smoke-marketplace-escrow-buy.sh >"$PROV_LOG" 2>&1
PROV_RC=$?
set -e
tail -n 50 "$PROV_LOG"
grep -q 'CONNECT_OK' "$PROV_LOG" || {
  echo "FATAL: provision CONNECT failed rc=$PROV_RC"
  exit 1
}

OID=$(grep -Eo 'oid=[0-9a-f-]{36}' "$PROV_LOG" | tail -1 | cut -d= -f2)
[[ -n "$OID" ]] || { echo "FATAL: no order id"; exit 1; }
echo "oid=$OID"

# Prefer credentials captured during smoke (/tmp/cred.json); public API can 502 under load.
if [[ -f /tmp/cred.json ]]; then
  cp -f /tmp/cred.json /tmp/m1-connect/cred.json
  echo "credentials_source=smoke_/tmp/cred.json"
else
  CRED_CODE=$(curl -sS -o /tmp/m1-connect/cred.json -w '%{http_code}' \
    -H "Authorization: Bearer $BUYER_JWT" "http://127.0.0.1:18080/v1/orders/$OID/credentials" \
    || curl -sS -o /tmp/m1-connect/cred.json -w '%{http_code}' \
      -H "Authorization: Bearer $BUYER_JWT" "$API/v1/orders/$OID/credentials")
  echo "credentials HTTP=$CRED_CODE"
  [[ "$CRED_CODE" == "200" ]] || { cat /tmp/m1-connect/cred.json; exit 1; }
fi

PROXY_USER=$(python3 - <<'PY'
import json
d = json.load(open("/tmp/m1-connect/cred.json"))
c = d.get("proxy_credentials") or d
print(c.get("username") or c.get("user") or "")
PY
)
PROXY_PASS=$(python3 - <<'PY'
import json
d = json.load(open("/tmp/m1-connect/cred.json"))
c = d.get("proxy_credentials") or d
print(c.get("password") or c.get("pass") or "")
PY
)
[[ -n "$PROXY_USER" && -n "$PROXY_PASS" ]] || { echo "FATAL: missing proxy creds"; exit 1; }
echo "proxy_user=${PROXY_USER:0:4}***"

echo "=== soak ${DURATION_SECS}s x${CONCURRENCY} ==="
export PROXY_HOST PROXY_USER PROXY_PASS TARGET_URL DURATION_SECS CONCURRENCY LOG OID PACING_MS
set +e
python3 - <<'PY'
import collections
import json
import os
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

host = os.environ["PROXY_HOST"]
user = os.environ["PROXY_USER"]
password = os.environ["PROXY_PASS"]
target = os.environ["TARGET_URL"]
duration = int(os.environ["DURATION_SECS"])
concurrency = int(os.environ["CONCURRENCY"])
pacing_ms = int(os.environ.get("PACING_MS", "50"))
log_path = os.environ["LOG"]

proxy = f"http://{user}:{password}@{host}"
end = time.time() + duration
counts = collections.Counter()
latencies = []
lock = threading.Lock()
next_slot = time.time()


def one():
    global next_slot
    with lock:
        slot = max(time.time(), next_slot)
        next_slot = slot + (pacing_ms / 1000.0)
    delay = slot - time.time()
    if delay > 0:
        time.sleep(delay)
    t0 = time.time()
    try:
        p = subprocess.run(
            [
                "curl",
                "-sS",
                "--max-time",
                "25",
                "-x",
                proxy,
                "-o",
                "/dev/null",
                "-w",
                "%{http_code}",
                target,
            ],
            capture_output=True,
            text=True,
        )
        code = (p.stdout or "").strip() or "000"
        ms = int((time.time() - t0) * 1000)
        with lock:
            counts[code] += 1
            latencies.append(ms)
            if p.returncode != 0:
                counts[f"curl_rc_{p.returncode}"] += 1
    except Exception:
        with lock:
            counts["exc"] += 1


with ThreadPoolExecutor(max_workers=concurrency) as ex:
    futs = []
    while time.time() < end:
        while len(futs) < concurrency * 2 and time.time() < end:
            futs.append(ex.submit(one))
        done = [f for f in futs if f.done()]
        for f in done:
            f.result()
            futs.remove(f)
        time.sleep(0.02)
    for f in as_completed(futs):
        f.result()

total = sum(v for k, v in counts.items() if str(k).isdigit())
ok = counts.get("200", 0)
fail = total - ok
lat = sorted(latencies)


def pct(p):
    if not lat:
        return None
    i = min(len(lat) - 1, max(0, int(round((p / 100) * (len(lat) - 1)))))
    return lat[i]


summary = {
    "total": total,
    "ok_200": ok,
    "fail": fail,
    "success_rate": (ok / total if total else 0),
    "p50_ms": pct(50),
    "p95_ms": pct(95),
    "p99_ms": pct(99),
    "codes": dict(counts),
    "target": target,
    "pacing_ms": pacing_ms,
    "concurrency": concurrency,
}
open(log_path, "w", encoding="utf-8").write(json.dumps(summary, indent=2) + "\n")
print(json.dumps(summary, indent=2))
if total < 10 or (ok / total) < 0.95:
    raise SystemExit(1)
PY
SOAK_RC=$?
set -e

export M1_STAMP="$STAMP" M1_RC="$SOAK_RC" M1_EVIDENCE="$EVIDENCE" M1_LOG="$LOG" M1_OID="$OID"
export M1_PROXY_HOST="$PROXY_HOST" M1_TARGET="$TARGET_URL" M1_CONC="$CONCURRENCY" M1_DUR="$DURATION_SECS"
python3 - <<'PY'
import json
import os
import pathlib

stamp = os.environ["M1_STAMP"]
rc = int(os.environ["M1_RC"])
ev = pathlib.Path(os.environ["M1_EVIDENCE"])
log = pathlib.Path(os.environ["M1_LOG"])
summary = json.loads(log.read_text(encoding="utf-8")) if log.exists() else {}
verdict = "CONNECT_SOAK_PASS" if rc == 0 else "CONNECT_SOAK_FAIL"
lines = [
    f"# M1 CONNECT soak — {verdict}",
    "",
    f"**When:** {stamp}",
    f"**Proxy:** `{os.environ['M1_PROXY_HOST']}`",
    f"**Target:** `{os.environ['M1_TARGET']}`",
    f"**Concurrency:** {os.environ['M1_CONC']}",
    f"**Duration:** {os.environ['M1_DUR']}s",
    f"**Order:** `{os.environ['M1_OID']}`",
    f"**Verdict:** `{verdict}`",
    "",
    "## Results",
    "",
    "```json",
    json.dumps(summary, indent=2),
    "```",
    "",
    f"Provision log: `/tmp/m1-connect/provision-{stamp}.log`",
    "",
    "SLO gate: ≥95% HTTP 200 through buyer proxy CONNECT path.",
]
ev.write_text("\n".join(lines) + "\n", encoding="utf-8")
print("evidence", ev)
print(verdict)
PY

echo "=== release after soak ==="
curl -sS -m 30 -o /tmp/m1-connect/release.json -w 'release_http=%{http_code}\n' \
  -X POST -H "Authorization: Bearer $BUYER_JWT" -H 'Content-Type: application/json' -d '{}' \
  "$API/v1/escrow/$OID/release" || true

exit "$SOAK_RC"

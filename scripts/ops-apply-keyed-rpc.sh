#!/usr/bin/env bash
# Apply a keyed Solana RPC as primary on gcp-testnet, keep public endpoints as fallbacks,
# recreate control-api, then run quiet settle (unless SKIP_SETTLE=1).
#
# Usage:
#   KEYED_RPC_URL='https://devnet.helius-rpc.com/?api-key=...' bash scripts/ops-apply-keyed-rpc.sh
#   KEYED_RPC_URL='https://xxxx.solana-devnet.quiknode.pro/TOKEN/' bash scripts/ops-apply-keyed-rpc.sh
#   SECRET=proxyhubb-testnet-solana-rpc-url bash scripts/ops-apply-keyed-rpc.sh
#   SKIP_SETTLE=1 ...  # wire only
set -euo pipefail
cd /opt/proxyhubb
# Recreate MUST keep W6 private CP + W10.A observe. Never --remove-orphans
# (J2 edges / redis-ha look like orphans to this API-only file set).
DC=(docker)
if ! docker info >/dev/null 2>&1 && command -v sudo >/dev/null; then
  DC=(sudo docker)
fi
COMPOSE=("${DC[@]}" compose
  -f docker-compose.yml
  -f docker-compose.testnet.yml
  -f docker-compose.gcp-testnet.yml)
if [[ -f docker-compose.w6-host-a-private.yml ]]; then
  COMPOSE+=(-f docker-compose.w6-host-a-private.yml)
fi
if [[ -f docker-compose.w10-observe.yml ]]; then
  COMPOSE+=(-f docker-compose.w10-observe.yml)
fi
PROJECT="${GCP_PROJECT:-gen-lang-client-0022105784}"
SECRET="${SECRET:-}"
SKIP_SETTLE="${SKIP_SETTLE:-0}"

mask_rpc() {
  sed -E 's/(api-key=)[^&[:space:]]+/\1***/g; s#(/[A-Za-z0-9_-]{16,})/#/***/#g'
}

resolve_url() {
  if [[ -n "${KEYED_RPC_URL:-}" ]]; then
    printf '%s' "$KEYED_RPC_URL"
    return
  fi
  local name="${SECRET:-proxyhubb-testnet-solana-rpc-url}"
  if gcloud secrets describe "$name" --project="$PROJECT" >/dev/null 2>&1; then
    gcloud secrets versions access latest --secret="$name" --project="$PROJECT" | tr -d '\r\n'
    return
  fi
  printf ''
}

URL="$(resolve_url | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')"
if [[ -z "$URL" ]]; then
  cat <<'EOF'
FATAL: no keyed RPC URL provided.

Create one (free Helius/QuickNode devnet key), then either:

  KEYED_RPC_URL='https://devnet.helius-rpc.com/?api-key=YOUR_KEY' \
    bash scripts/ops-apply-keyed-rpc.sh

or store it and re-run:

  echo -n 'https://...' | gcloud secrets create proxyhubb-testnet-solana-rpc-url \
    --project=gen-lang-client-0022105784 --data-file=-
  SECRET=proxyhubb-testnet-solana-rpc-url bash scripts/ops-apply-keyed-rpc.sh
EOF
  exit 2
fi

case "$URL" in
  http://*|https://*) ;;
  *) echo "FATAL: must be http(s) URL"; exit 2 ;;
esac

echo "keyed_rpc=$(printf '%s' "$URL" | mask_rpc)"

echo "=== probe keyed RPC ==="
export URL
python3 - <<'PY'
import json, os, sys, urllib.request
url = os.environ["URL"]
payload = json.dumps({
    "jsonrpc": "2.0",
    "id": 1,
    "method": "getLatestBlockhash",
    "params": [{"commitment": "confirmed"}],
}).encode()
req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
try:
    with urllib.request.urlopen(req, timeout=15) as r:
        j = json.loads(r.read().decode())
except Exception as e:
    print("PROBE_FAIL", e)
    sys.exit(1)
if "error" in j:
    print("PROBE_FAIL", j["error"])
    sys.exit(1)
print("PROBE_OK slot=", j.get("result", {}).get("context", {}).get("slot"))
PY

echo "=== update .env ==="
PY=(python3)
if [[ -e .env && ! -w .env ]]; then PY=(sudo --preserve-env=URL python3); fi
"${PY[@]}" - <<'PY'
from datetime import datetime, timezone
from pathlib import Path
import os

url = os.environ["URL"]
fallbacks = [
    "https://api.devnet.solana.com",
    "https://solana-devnet.api.onfinality.io/public",
]
endpoints = ",".join([url] + [e for e in fallbacks if e != url])
p = Path(".env")
text = p.read_text() if p.exists() else ""
if p.exists():
    bak = Path(f".env.bak.keyed-rpc-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}")
    bak.write_text(text)
    print("backup", bak)
lines = []
seen_ep = seen_eps = False
for line in text.splitlines():
    if line.startswith("SOLANA_RPC_ENDPOINT="):
        lines.append(f"SOLANA_RPC_ENDPOINT={url}")
        seen_ep = True
    elif line.startswith("SOLANA_RPC_ENDPOINTS="):
        lines.append(f"SOLANA_RPC_ENDPOINTS={endpoints}")
        seen_eps = True
    else:
        lines.append(line)
if not seen_ep:
    lines.append(f"SOLANA_RPC_ENDPOINT={url}")
if not seen_eps:
    lines.append(f"SOLANA_RPC_ENDPOINTS={endpoints}")
p.write_text("\n".join(lines) + "\n")
print("updated SOLANA_RPC_*")
PY

echo "=== recreate control-api (no --remove-orphans) ==="
echo "compose_files=${COMPOSE[*]}"
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api
for i in $(seq 1 40); do
  st=$("${DC[@]}" inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' proxyhubb-control-api-1 2>/dev/null || echo missing)
  echo "try=$i health=$st"
  [[ "$st" == "healthy" ]] && break
  sleep 3
done
curl -sS -m 5 http://127.0.0.1:18080/health || true
echo
"${COMPOSE[@]}" exec -T control-api printenv SOLANA_RPC_ENDPOINT | mask_rpc
"${COMPOSE[@]}" exec -T control-api printenv SOLANA_RPC_ENDPOINTS | mask_rpc
"${COMPOSE[@]}" exec -T control-api printenv PROXYHUB_SESSION_CAPABILITY || true
"${COMPOSE[@]}" exec -T control-api printenv GATEWAY_OP_A_HOST_ID || true
"${COMPOSE[@]}" exec -T control-api printenv GATEWAY_OP_B_HOST_ID || true

if [[ "$SKIP_SETTLE" == "1" ]]; then
  echo KEYED_RPC_APPLIED_SKIP_SETTLE
  exit 0
fi

echo "=== quiet settle ==="
# Smoke client also uses keyed RPC when RPC= is set
export RPC="$URL"
export HOLD_RELEASE=1 REQUIRE_CONNECT=0 SKIP_NODE_SOFT_DELETE=1 KEEP_ORDER=1
export SETTLE_COOLDOWN_SECS="${SETTLE_COOLDOWN_SECS:-15}"
export NODE_ID="${NODE_ID:-4b60f9e2-11dc-4240-a332-6ec9f3669379}"
export LISTING_ID="${LISTING_ID:-c1472dbc-dee3-407e-8fea-ec3ed42489ac}"
export ORACLE_KP="${ORACLE_KP:-/tmp/smoke-funder.json}"
set +e
bash scripts/gcp-smoke-marketplace-escrow-buy.sh >/tmp/keyed-quiet-settle.log 2>&1
RC=$?
set -e
tail -n 70 /tmp/keyed-quiet-settle.log
if grep -q 'RELEASE_OK' /tmp/keyed-quiet-settle.log; then
  echo KEYED_SETTLE_PASS
else
  if grep -q 'escrow_settle_queued\|settle_queued' /tmp/keyed-quiet-settle.log; then
    echo KEYED_SETTLE_QUEUED
  else
    echo KEYED_SETTLE_FAIL rc=$RC
  fi
  exit 1
fi
echo KEYED_RPC_SETTLE_DONE

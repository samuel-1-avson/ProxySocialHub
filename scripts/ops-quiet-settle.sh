#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo "=== control-api health ==="
docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}} restarts={{.RestartCount}}' proxyhubb-control-api-1
curl -sS -m 5 http://127.0.0.1:18080/health || true
echo
docker logs proxyhubb-control-api-1 --since 15m 2>&1 | grep -iE 'panic|fatal|oom|killed|Listen|started|ERROR.*settle|blockhash' | tail -40 || true

# If unhealthy, bounce once
st=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' proxyhubb-control-api-1 2>/dev/null || echo missing)
if [[ "$st" != "healthy" ]]; then
  echo "restarting control-api"
  "${COMPOSE[@]}" up -d control-api
  sleep 15
fi

# Quiet settle: longer cooldown, no CONNECT, keep order
export RPC=https://api.devnet.solana.com
export HOLD_RELEASE=1
export REQUIRE_CONNECT=0
export SKIP_NODE_SOFT_DELETE=1
export KEEP_ORDER=1
export SETTLE_COOLDOWN_SECS=60
export NODE_ID=4b60f9e2-11dc-4240-a332-6ec9f3669379
export LISTING_ID=c1472dbc-dee3-407e-8fea-ec3ed42489ac
export ORACLE_KP=/tmp/smoke-funder.json

echo "=== pre-settle RPC probe ==="
python3 - <<'PY'
import json,urllib.request,time
url='https://api.devnet.solana.com'
payload=json.dumps({"jsonrpc":"2.0","id":1,"method":"getLatestBlockhash","params":[{"commitment":"confirmed"}]}).encode()
for i in range(3):
  t0=time.time()
  try:
    req=urllib.request.Request(url,data=payload,headers={"Content-Type":"application/json"})
    with urllib.request.urlopen(req,timeout=12) as r:
      j=json.loads(r.read().decode())
    print(i, 'OK' if 'result' in j else j, int((time.time()-t0)*1000))
  except Exception as e:
    print(i, 'FAIL', e)
  time.sleep(2)
PY

echo "=== quiet settle smoke ==="
set +e
bash scripts/gcp-smoke-marketplace-escrow-buy.sh >/tmp/quiet-settle.log 2>&1
RC=$?
set -e
tail -n 80 /tmp/quiet-settle.log
if grep -q 'RELEASE_OK' /tmp/quiet-settle.log; then
  echo QUIET_SETTLE_PASS
elif grep -q 'escrow_settle_queued\|settle_queued' /tmp/quiet-settle.log; then
  echo QUIET_SETTLE_QUEUED
else
  echo QUIET_SETTLE_FAIL rc=$RC
fi
echo QUIET_SETTLE_DONE

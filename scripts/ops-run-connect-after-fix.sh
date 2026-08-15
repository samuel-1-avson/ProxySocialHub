#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb

# Ensure funder has no BOM
python3 - <<'PY'
from pathlib import Path
import json
p=Path('/tmp/smoke-funder.json')
raw=p.read_bytes()
if raw.startswith(b'\xef\xbb\xbf'):
  raw=raw[3:]; p.write_bytes(raw)
d=json.loads(raw)
assert isinstance(d,list) and len(d)==64
print('funder_ok')
PY

# Provider tunnel still up?
if ! docker logs proxyhubb-provider-node --tail 20 2>&1 | grep -q 'tunnel established'; then
  echo "restarting provider-node"
  docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml -f docker-compose.provider.yml --profile provider up -d provider-node
  sleep 8
fi
docker logs proxyhubb-provider-node --tail 8 2>&1 | grep -iE 'tunnel|error|auth' || true

rm -f /tmp/cred.json
export REQUIRE_CONNECT=1 HOLD_RELEASE=1 SKIP_NODE_SOFT_DELETE=1 KEEP_ORDER=0
export NODE_ID=4b60f9e2-11dc-4240-a332-6ec9f3669379
export LISTING_ID=c1472dbc-dee3-407e-8fea-ec3ed42489ac
export ORACLE_KP=/tmp/smoke-funder.json
bash scripts/ops-wave1-connect-e2e.sh

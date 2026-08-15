#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
USER="${1:-28cf3f20ff69431c}"
echo "=== funder file ==="
ls -la /tmp/smoke-funder.json 2>/dev/null || echo missing
python3 - <<'PY'
import json
from pathlib import Path
p=Path('/tmp/smoke-funder.json')
if not p.exists():
  print('no funder'); raise SystemExit
raw=p.read_text().strip()
print('bytes', len(raw), 'starts', raw[:40])
try:
  d=json.loads(raw)
  if isinstance(d, list):
    print('keypair_len', len(d))
  elif isinstance(d, dict):
    print('keys', list(d)[:8])
  else:
    print('type', type(d))
except Exception as e:
  print('json_err', e)
PY

echo "=== redis session:$USER ==="
RAW=$("${COMPOSE[@]}" exec -T redis redis-cli GET "session:$USER" | tr -d '\r')
echo "raw=${RAW:0:500}"
echo "---"
"${COMPOSE[@]}" exec -T redis redis-cli KEYS 'session:*' | head -40

echo "=== recent sessions for buyer ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT id, status, left(credentials_user,24) AS u, left(credentials_pass,24) AS p, created_at FROM sessions WHERE user_id='76609a25-0b69-4e05-9640-4c67d7a07f36' ORDER BY created_at DESC LIMIT 5;"

echo "=== edge redis URL ==="
"${COMPOSE[@]}" exec -T edge-gateway printenv | grep -iE 'REDIS|SESSION' | sed 's/=.*/=***/' || true
"${COMPOSE[@]}" exec -T control-api printenv | grep -iE 'REDIS' | sed 's/=.*/=***/' || true

echo INSPECT_DONE

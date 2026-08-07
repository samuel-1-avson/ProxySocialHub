#!/bin/bash
# =============================================================================
# DANGER — DO NOT RUN ON LIVE / proxyhubb-testnet
# =============================================================================
# This script collapses SOLANA_TREASURY_ADDRESS and SOLANA_TREASURY_HOT_ADDRESS
# back onto the oracle pubkey (BC-08 anti-pattern: treasury == hot wallet == oracle).
#
# Kept only for emergency local debugging of *pre-split* environments.
# Live path: vault PDA deposits + distinct hot payouts + GCP KMS oracle.
# See docs/custody-split.md and scripts/gcp-split-treasury-address.sh
#
# To force-run anyway (you will undo custody split):
#   ALLOW_ALIGN_TREASURY_TO_ORACLE=I_UNDERSTAND_BC08 bash scripts/gcp-align-treasury-to-oracle.sh
# =============================================================================
set -euo pipefail

if [[ "${ALLOW_ALIGN_TREASURY_TO_ORACLE:-}" != "I_UNDERSTAND_BC08" ]]; then
  echo "REFUSED: gcp-align-treasury-to-oracle collapses custody onto the oracle." >&2
  echo "This undoes BC-08. Set ALLOW_ALIGN_TREASURY_TO_ORACLE=I_UNDERSTAND_BC08 to override." >&2
  exit 2
fi

cd /opt/proxyhubb

ORACLE=8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2
OLD=8g7WUuPosAg82Uu7iGYCx6HBnoTBFb4QuyiJCEGzktU4

COMPOSE=(sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo "=== before ==="
grep -E 'SOLANA_TREASURY' .env || true

# Backup .env
sudo cp -a .env ".env.bak.treasury-$(date -u +%Y%m%d%H%M%S)"

python3 - <<'PY'
from pathlib import Path
path = Path('.env')
text = path.read_text()
lines = text.splitlines(True)
oracle = '8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2'
keys = {
  'SOLANA_TREASURY_ADDRESS': oracle,
  'SOLANA_TREASURY_HOT_ADDRESS': oracle,
}
seen = set()
out = []
for line in lines:
  if not line.strip() or line.lstrip().startswith('#') or '=' not in line:
    out.append(line)
    continue
  k, _, _ = line.partition('=')
  k = k.strip()
  if k in keys:
    out.append(f"{k}={keys[k]}\n")
    seen.add(k)
  else:
    out.append(line)
for k, v in keys.items():
  if k not in seen:
    out.append(f"{k}={v}\n")
path.write_text(''.join(out))
print('updated .env treasury keys ->', oracle)
PY

echo "=== update DB + clear redis config cache ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb <<SQL
UPDATE system_configurations
SET value = '${ORACLE}', description = 'Central Treasury Wallet for Solana Deposits (aligned to oracle)', updated_at = NOW()
WHERE key = 'treasury_wallet_solana';

INSERT INTO system_configurations (id, key, value, description, created_at, updated_at)
SELECT gen_random_uuid(), 'treasury_wallet_solana', '${ORACLE}',
       'Central Treasury Wallet for Solana Deposits (aligned to oracle)', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM system_configurations WHERE key = 'treasury_wallet_solana');

SELECT key, value FROM system_configurations WHERE key = 'treasury_wallet_solana';
SQL

"${COMPOSE[@]}" exec -T redis redis-cli HDEL sys:config:hash treasury_wallet_solana || true
"${COMPOSE[@]}" exec -T redis redis-cli HSET sys:config:hash treasury_wallet_solana "${ORACLE}" || true

echo "=== after env ==="
grep -E 'SOLANA_TREASURY' .env

echo "=== recreate control-api ==="
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api
sleep 15

echo "=== verify ==="
echo -n "health="; curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18080/health
curl -sS http://127.0.0.1:18080/v1/system/config
echo
curl -sS http://127.0.0.1:18080/v1/crypto/treasury
echo
echo "NOTE: old address ${OLD} still holds stranded SOL until swept."
echo "New deposits -> ${ORACLE}"
echo DONE

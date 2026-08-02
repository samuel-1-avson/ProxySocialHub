#!/bin/bash
set -euo pipefail
cd /opt/proxyhubb

echo "=== env (redacted) ==="
grep -E 'ORACLE_|TREASURY_|SOLANA_RPC|SOLANA_CLUSTER|CLUSTER' .env 2>/dev/null \
  | sed -E 's/(KEY|SECRET|PRIVATE|MNEMONIC)=.*/\1=***/' || true

echo "=== oracle keypair path ==="
ls -la infra/oracle-keypair.json 2>/dev/null || ls -la /opt/proxyhubb/infra/oracle-keypair.json 2>/dev/null || true

echo "=== derive oracle pubkey if python/solana available ==="
if command -v python3 >/dev/null 2>&1 && [ -f infra/oracle-keypair.json ]; then
  python3 - <<'PY'
import json, base58, hashlib
try:
    from nacl.signing import SigningKey
except ImportError:
    SigningKey = None
path='infra/oracle-keypair.json'
raw=json.load(open(path))
if isinstance(raw, list):
    seed=bytes(raw[:32])
    print('keypair_bytes', len(raw))
    if SigningKey:
        sk=SigningKey(seed)
        print('oracle_pubkey', base58.b58encode(bytes(sk.verify_key)).decode())
    else:
        # solana keypair json is 64 bytes; pubkey is last 32
        if len(raw)==64:
            print('oracle_pubkey', base58.b58encode(bytes(raw[32:])).decode())
        else:
            print('need PyNaCl or 64-byte keypair to print pubkey')
else:
    print('unexpected keypair format', type(raw))
PY
fi

echo "=== system config treasury ==="
sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml exec -T postgres \
  psql -U proxyhubb -d proxyhubb -c "SELECT key, value FROM system_configs WHERE key ILIKE '%treasury%' OR key ILIKE '%oracle%' LIMIT 20;" 2>/dev/null || true

echo "=== control-api logs (withdraw) ==="
sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml logs --tail=80 control-api 2>/dev/null | grep -iE 'withdraw|treasury|insufficient|SendSOL|oracle' || true

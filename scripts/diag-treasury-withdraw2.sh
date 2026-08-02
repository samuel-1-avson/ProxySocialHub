#!/bin/bash
set -euo pipefail
cd /opt/proxyhubb

echo "=== derive oracle pubkey via node/python ==="
python3 - <<'PY'
import json
raw=json.load(open('infra/oracle-keypair.json'))
assert isinstance(raw, list), type(raw)
print('keypair_len', len(raw))
# Solana CLI keypair: 64 bytes, pubkey = bytes[32:]
if len(raw) == 64:
    b=bytes(raw[32:])
    # base58 encode without dependency
    alphabet=b'123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
    n=int.from_bytes(b,'big')
    enc=bytearray()
    while n>0:
        n,r=divmod(n,58)
        enc.append(alphabet[r])
    pad=0
    for x in b:
        if x==0: pad+=1
        else: break
    print('oracle_pubkey', (alphabet[0:1]*pad + bytes(reversed(enc))).decode())
elif len(raw)==32:
    print('32-byte seed only; need to derive ed25519 pubkey')
else:
    print('unexpected len', len(raw))
PY

ORACLE_PUB=$(python3 - <<'PY'
import json
raw=json.load(open('infra/oracle-keypair.json'))
b=bytes(raw[32:]) if len(raw)==64 else None
alphabet=b'123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
n=int.from_bytes(b,'big')
enc=bytearray()
while n>0:
    n,r=divmod(n,58)
    enc.append(alphabet[r])
pad=sum(1 for x in b if x==0)
# fix pad logic
pad=0
for x in b:
  if x==0: pad+=1
  else: break
print((alphabet[0:1]*pad + bytes(reversed(enc))).decode())
PY
)

TREASURY=8g7WUuPosAg82Uu7iGYCx6HBnoTBFb4QuyiJCEGzktU4
echo "oracle_pubkey=$ORACLE_PUB"
echo "treasury=$TREASURY"

echo "=== balances via public RPC ==="
for ADDR in "$ORACLE_PUB" "$TREASURY"; do
  BAL=$(curl -sS https://api.devnet.solana.com -H 'Content-Type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getBalance\",\"params\":[\"$ADDR\"]}" | python3 -c 'import sys,json; r=json.load(sys.stdin); print(r.get("result",{}).get("value","err"), r.get("error",""))')
  echo "$ADDR => $BAL lamports"
done

echo "=== recent withdraw logs ==="
sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml logs --tail=200 control-api 2>/dev/null \
  | grep -iE 'withdraw|insufficient lamports|SendSOL|SOL withdrawal' | tail -40 || true

echo "=== ORACLE env presence ==="
grep -E '^(ORACLE_|SOLANA_ORACLE|ORACLE_KEYPAIR)' .env | sed -E 's/=.*/=***/' || true

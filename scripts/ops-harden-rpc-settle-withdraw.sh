#!/usr/bin/env bash
# Flip Solana RPC primary away from rate-limited OnFinality public, rebuild control-api,
# then prove settle + withdraw.
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo "=== reorder SOLANA_RPC_* in .env ==="
python3 - <<'PY'
from pathlib import Path
p=Path('.env')
text=p.read_text()
lines=[]
changed=False
for line in text.splitlines():
  if line.startswith('SOLANA_RPC_ENDPOINT=') and 'onfinality' in line.lower():
    lines.append('SOLANA_RPC_ENDPOINT=https://api.devnet.solana.com')
    changed=True
  elif line.startswith('SOLANA_RPC_ENDPOINTS='):
    lines.append('SOLANA_RPC_ENDPOINTS=https://api.devnet.solana.com,https://solana-devnet.api.onfinality.io/public')
    changed=True
  else:
    lines.append(line)
if not any(l.startswith('SOLANA_RPC_ENDPOINT=') for l in lines):
  lines.append('SOLANA_RPC_ENDPOINT=https://api.devnet.solana.com')
  changed=True
if not any(l.startswith('SOLANA_RPC_ENDPOINTS=') for l in lines):
  lines.append('SOLANA_RPC_ENDPOINTS=https://api.devnet.solana.com,https://solana-devnet.api.onfinality.io/public')
  changed=True
p.write_text('\n'.join(lines)+('\n' if text.endswith('\n') else ''))
print('changed=', changed)
for l in lines:
  if l.startswith('SOLANA_RPC'):
    print(l)
PY

echo "=== sync patched solana sources if present in /tmp ==="
for f in client.go settlement.go rpc_endpoint.go; do
  if [[ -f /tmp/$f ]]; then
    case $f in
      client.go) dest=services/control-api/internal/solana/client.go ;;
      settlement.go) dest=services/control-api/internal/solana/settlement.go ;;
      rpc_endpoint.go) dest=services/control-api/internal/solana/rpc_endpoint.go ;;
    esac
    cp "/tmp/$f" "$dest"
    echo "copied $f -> $dest"
  fi
done

echo "=== rebuild+restart control-api ==="
bash scripts/ops-rebuild-control-api.sh

echo "=== verify RPC env in container ==="
"${COMPOSE[@]}" exec -T control-api sh -c 'printenv | grep -E "^SOLANA_RPC"'

echo RPC_HARDEN_DONE

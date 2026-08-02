#!/usr/bin/env bash
# BC-08/09: wire distinct treasury hot wallet on proxyhubb-testnet.
# Run ON the VM (via gcloud ssh). Never prints private key material.
#
# Steps:
#   1) Generate treasury-hot keypair under /opt/proxyhubb/secrets/ (readable by appuser)
#   2) Optionally backup to GCP Secret Manager (pubkey + encrypted file versions)
#   3) Update .env SOLANA_TREASURY_* to the new hot pubkey
#   4) Point deposit address (DB + redis) at hot wallet
#   5) Rebuild/recreate control-api
#   6) Optionally fund hot wallet from oracle (0.5 SOL) if solana CLI available
set -euo pipefail

cd /opt/proxyhubb

COMPOSE=(sudo docker compose
  -f docker-compose.yml
  -f docker-compose.testnet.yml
  -f docker-compose.gcp-testnet.yml
)

ORACLE_PUB="${ORACLE_PUB:-8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2}"
SECRETS_DIR="/opt/proxyhubb/secrets"
HOT_FILE="${SECRETS_DIR}/treasury-hot-keypair.json"
PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
SECRET_NAME="${SECRET_NAME:-proxyhubb-testnet-treasury-hot-keypair}"

sudo mkdir -p "${SECRETS_DIR}"
sudo chmod 700 "${SECRETS_DIR}"

echo "=== 1) ensure treasury hot keypair (on-VM only) ==="
if [[ -f "${HOT_FILE}" ]]; then
  echo "EXISTING_HOT_KEYPAIR=${HOT_FILE}"
else
  # Generate with solana-keygen if present; else docker solanalabs image; else node ed25519
  if command -v solana-keygen >/dev/null 2>&1; then
    sudo solana-keygen new --no-bip39-passphrase --silent -o "${HOT_FILE}"
  else
    sudo docker run --rm -v "${SECRETS_DIR}:/out" node:20-alpine node -e '
      const crypto=require("crypto");
      const fs=require("fs");
      const {privateKey, publicKey}=crypto.generateKeyPairSync("ed25519");
      const seed=privateKey.export({type:"pkcs8",format:"der"}).subarray(-32);
      const pub=publicKey.export({type:"spki",format:"der"}).subarray(-32);
      const kp=Buffer.concat([seed, pub]);
      fs.writeFileSync("/out/treasury-hot-keypair.json", JSON.stringify([...kp]));
    '
  fi
  sudo chmod 644 "${HOT_FILE}"
  sudo chown root:root "${HOT_FILE}"
  echo "GENERATED_HOT_KEYPAIR=${HOT_FILE}"
fi

echo "=== 2) derive hot pubkey (no private material) ==="
HOT_PUB=$(sudo docker run --rm -v "${HOT_FILE}:/kp.json:ro" node:20-alpine node -e '
  const fs=require("fs");
  const crypto=require("crypto");
  const kp=JSON.parse(fs.readFileSync("/kp.json","utf8"));
  if (!Array.isArray(kp) || kp.length!==64) { console.error("bad keypair"); process.exit(1); }
  const pub=Buffer.from(kp.slice(32));
  const ALPHABET="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  function b58(buf){
    let n=BigInt("0x"+buf.toString("hex")); let out="";
    while(n>0n){ const r=n%58n; n=n/58n; out=ALPHABET[Number(r)]+out; }
    for (const b of buf){ if(b===0) out="1"+out; else break; }
    return out || "1";
  }
  process.stdout.write(b58(pub));
')
echo "HOT_PUB=${HOT_PUB}"
if [[ "${HOT_PUB}" == "${ORACLE_PUB}" ]]; then
  echo "FATAL: hot pubkey equals oracle — regenerate" >&2
  exit 1
fi

echo "=== 3) optional Secret Manager backup of key file ==="
if command -v gcloud >/dev/null 2>&1 && [[ -n "${PROJECT_ID}" && "${PROJECT_ID}" != "(unset)" ]]; then
  if gcloud secrets describe "${SECRET_NAME}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
    sudo cat "${HOT_FILE}" | gcloud secrets versions add "${SECRET_NAME}" --project="${PROJECT_ID}" --data-file=- >/dev/null
    echo "SECRET_VERSION_ADDED=${SECRET_NAME}"
  else
    sudo cat "${HOT_FILE}" | gcloud secrets create "${SECRET_NAME}" --project="${PROJECT_ID}" --replication-policy=automatic --data-file=- >/dev/null
    echo "SECRET_CREATED=${SECRET_NAME}"
  fi
  # Store pubkey as a separate non-sensitive secret for ops discoverability
  PUB_SECRET="${SECRET_NAME}-pubkey"
  if gcloud secrets describe "${PUB_SECRET}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
    printf '%s' "${HOT_PUB}" | gcloud secrets versions add "${PUB_SECRET}" --project="${PROJECT_ID}" --data-file=- >/dev/null || true
  else
    printf '%s' "${HOT_PUB}" | gcloud secrets create "${PUB_SECRET}" --project="${PROJECT_ID}" --replication-policy=automatic --data-file=- >/dev/null || true
  fi
  echo "SECRET_PUBKEY=${PUB_SECRET}"
else
  echo "SKIP_SECRET_MANAGER (gcloud/project unavailable)"
fi

echo "=== 4) update .env (backup first) ==="
sudo cp -a .env ".env.bak.custody-$(date -u +%Y%m%d%H%M%S)"
sudo python3 - <<PY
from pathlib import Path
path = Path('/opt/proxyhubb/.env')
text = path.read_text()
lines = text.splitlines(True)
hot = "${HOT_PUB}"
keys = {
  'SOLANA_TREASURY_HOT_ADDRESS': hot,
  'SOLANA_TREASURY_ADDRESS': hot,  # deposits -> funded payout wallet on testnet
  'SOLANA_TREASURY_HOT_KEYPAIR': '/run/secrets/treasury-hot-keypair.json',
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
print('updated .env treasury hot ->', hot)
PY

echo "=== 5) update DB deposit address + redis cache ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb <<SQL
UPDATE system_configurations
SET value = '${HOT_PUB}',
    description = 'Treasury hot wallet for deposits/payouts (BC-08 split from oracle)',
    updated_at = NOW()
WHERE key = 'treasury_wallet_solana';

INSERT INTO system_configurations (id, key, value, description, created_at, updated_at)
SELECT gen_random_uuid(), 'treasury_wallet_solana', '${HOT_PUB}',
       'Treasury hot wallet for deposits/payouts (BC-08 split from oracle)', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM system_configurations WHERE key = 'treasury_wallet_solana');

SELECT key, left(value, 12) || '…' AS value_prefix FROM system_configurations WHERE key = 'treasury_wallet_solana';
SQL

"${COMPOSE[@]}" exec -T redis redis-cli HDEL sys:config:hash treasury_wallet_solana || true
"${COMPOSE[@]}" exec -T redis redis-cli HSET sys:config:hash treasury_wallet_solana "${HOT_PUB}" || true

echo "=== 6) rebuild control-api with custody split code ==="
"${COMPOSE[@]}" build control-api
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api

echo "=== 7) wait healthy + verify custody logs ==="
for i in $(seq 1 36); do
  if curl -sf http://127.0.0.1:18080/health >/dev/null 2>&1 || curl -sf http://127.0.0.1:8080/health >/dev/null 2>&1; then
    echo "control-api healthy"
    break
  fi
  sleep 5
done

echo "--- custody env (redacted) ---"
"${COMPOSE[@]}" exec -T control-api sh -c 'echo APP_ENV=$APP_ENV; echo HOT_ADDR=${SOLANA_TREASURY_HOT_ADDRESS}; echo TREASURY_ADDR=${SOLANA_TREASURY_ADDRESS}; echo HOT_KP=${SOLANA_TREASURY_HOT_KEYPAIR}; echo ORACLE_KP=${SOLANA_ORACLE_KEYPAIR}'
echo "--- recent custody log lines ---"
"${COMPOSE[@]}" logs --tail=80 control-api 2>&1 | grep -E 'BC-08|custody|payout=|WARNING: BC-08|Treasury custody|FATAL' || true

echo "=== 8) fund hot wallet from oracle (0.5 SOL) if possible ==="
if command -v solana >/dev/null 2>&1 && [[ -f infra/oracle-keypair.json ]]; then
  solana transfer --from infra/oracle-keypair.json "${HOT_PUB}" 0.5 \
    --url https://api.devnet.solana.com --allow-unfunded-recipient --keypair infra/oracle-keypair.json \
    && echo "FUNDED_HOT_0.5_SOL" || echo "FUND_SKIPPED_OR_FAILED"
else
  echo "FUND_MANUAL: send SOL to ${HOT_PUB} from oracle ${ORACLE_PUB}"
fi

echo "=== summary ==="
echo "oracle_pub=${ORACLE_PUB}"
echo "hot_pub=${HOT_PUB}"
echo "hot_file=${HOT_FILE} (mode $(sudo stat -c '%a' "${HOT_FILE}" 2>/dev/null || echo '?'))"
echo "DONE"

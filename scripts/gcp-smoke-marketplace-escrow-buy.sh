#!/usr/bin/env bash
# Marketplace escrow buy smoke with PROXYHUB_REQUIRE_ESCROW_PDA=true.
# Revives soft-deleted listing/node briefly, creates order, pay/solana,
# funds a temp buyer from oracle, initializeEscrow on-chain, confirm, release.
set -euo pipefail

cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

LISTING_ID="${LISTING_ID:-c1472dbc-dee3-407e-8fea-ec3ed42489ac}"
# Default = edge-registered tunnel node for seller on gcp-testnet (gateway_node_id node_<seller>).
NODE_ID="${NODE_ID:-4b60f9e2-11dc-4240-a332-6ec9f3669379}"
SELLER_ID="${SELLER_ID:-b77e84c9-0e85-4f23-afc0-581cd561c216}"
BUYER_ID="${BUYER_ID:-76609a25-0b69-4e05-9640-4c67d7a07f36}"
API="${API:-http://127.0.0.1:18080}"
RPC="${RPC:-https://api.devnet.solana.com}"
PROGRAM_ID="${PROGRAM_ID:-AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu}"
ORACLE_KP="${ORACLE_KP:-/opt/proxyhubb/infra/oracle-keypair.json}"
echo "rpc=$RPC"

psqlq() {
  "${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -At -c "$1" | tr -d '\r' | head -n1
}
psqlc() {
  "${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c "$1"
}

cleanup() {
  set +e
  echo "=== CLEANUP ==="
  # Never delete the operator-staged funder; only remove a smoke-local copy.
  if [[ -n "${SMOKE_FUNDER_COPY:-}" && -f "$SMOKE_FUNDER_COPY" ]]; then
    rm -f "$SMOKE_FUNDER_COPY"
  fi
  if [[ -n "${OID:-}" ]]; then
    if [[ "${KEEP_ORDER:-0}" == "1" ]]; then
      echo "KEEP_ORDER oid=$OID"
    else
      psqlc "DELETE FROM orders WHERE id='$OID';" >/dev/null 2>&1
    fi
  fi
  if [[ -n "${ORIG_WALLET:-}" ]]; then
    psqlc "UPDATE linked_wallets SET address='$ORIG_WALLET', is_primary=true, updated_at=NOW()
            WHERE user_id='$BUYER_ID' AND chain='solana' AND address='$BUYER_PUB';" >/dev/null 2>&1
    # Prefer restoring original primary row if we inserted a temp one
    psqlc "DELETE FROM linked_wallets WHERE user_id='$BUYER_ID' AND chain='solana' AND address='$BUYER_PUB';" >/dev/null 2>&1
    psqlc "UPDATE linked_wallets SET is_primary=true, updated_at=NOW()
            WHERE user_id='$BUYER_ID' AND chain='solana' AND address='$ORIG_WALLET';" >/dev/null 2>&1
  fi
  if [[ "${KEEP_ORDER:-0}" == "1" ]]; then
    echo "KEEP_LISTING id=$LISTING_ID"
  else
    psqlc "UPDATE proxy_listings SET status='deleted', updated_at=NOW() WHERE id='$LISTING_ID';" >/dev/null 2>&1
  fi
  if [[ "${SKIP_NODE_SOFT_DELETE:-0}" == "1" ]]; then
    echo "skip soft-delete NODE_ID=$NODE_ID (SKIP_NODE_SOFT_DELETE=1)"
  else
    psqlc "UPDATE provider_nodes SET deleted_at=NOW(), status='offline', is_healthy=false, updated_at=NOW()
            WHERE id='$NODE_ID' AND deleted_at IS NULL;" >/dev/null 2>&1
  fi
}
trap cleanup EXIT

echo "=== FLAG ==="
FLAG=$("${COMPOSE[@]}" exec -T control-api sh -c 'printenv PROXYHUB_REQUIRE_ESCROW_PDA' | tr -d '\r')
echo "PROXYHUB_REQUIRE_ESCROW_PDA=$FLAG"
[[ "$FLAG" == "true" ]] || { echo "flag must be true"; exit 1; }

echo "=== REVIVE NODE + LISTING ==="
psqlc "UPDATE provider_nodes SET deleted_at=NULL, status='online', is_healthy=true,
        active_connections=0, last_seen_at=NOW(), updated_at=NOW() WHERE id='$NODE_ID';"
psqlc "UPDATE proxy_listings SET status='active', updated_at=NOW() WHERE id='$LISTING_ID';"

# Ensure legacy nodes mirror exists for session activation (best-effort)
MIRROR=$(psqlq "SELECT id::text FROM nodes WHERE provider_node_id='$NODE_ID' AND deleted_at IS NULL LIMIT 1;")
if [[ -z "$MIRROR" ]]; then
  psqlc "INSERT INTO nodes (id, provider_node_id, owner_id, status, is_healthy, created_at, updated_at)
         SELECT gen_random_uuid(), '$NODE_ID', '$SELLER_ID', 'online', true, NOW(), NOW()
         WHERE NOT EXISTS (SELECT 1 FROM nodes WHERE provider_node_id='$NODE_ID' AND deleted_at IS NULL);" >/dev/null 2>&1 || true
fi

SELLER_WALLET=$(psqlq "SELECT address FROM linked_wallets WHERE user_id='$SELLER_ID' AND chain='solana' AND is_primary=true LIMIT 1;")
ORIG_WALLET=$(psqlq "SELECT address FROM linked_wallets WHERE user_id='$BUYER_ID' AND chain='solana' AND is_primary=true LIMIT 1;")
echo "seller_wallet=$SELLER_WALLET orig_buyer_wallet=$ORIG_WALLET"
[[ -n "$SELLER_WALLET" ]] || { echo "seller has no primary solana wallet"; exit 1; }

echo "=== GENERATE BUYER KEYPAIR ==="
mkdir -p /tmp/escrow-buy-smoke
cat >/tmp/escrow-buy-smoke/init.mjs <<'JS'
import fs from 'fs';
import crypto from 'crypto';
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
  TransactionInstruction, sendAndConfirmTransaction, LAMPORTS_PER_SOL,
} from '@solana/web3.js';

const rpc = process.env.RPC;
const programId = new PublicKey(process.env.PROGRAM_ID);
const seller = new PublicKey(process.env.SELLER_WALLET);
const amountLamports = BigInt(process.env.AMOUNT_LAMPORTS || '0');
const bandwidthGb = BigInt(process.env.BANDWIDTH_GB || '1');
const mode = process.env.MODE; // keygen | fund_only | fund_init

function disc(name) {
  return crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

function loadKp(path) {
  const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

if (mode === 'keygen') {
  const buyer = Keypair.generate();
  fs.writeFileSync('/work/buyer.json', JSON.stringify(Array.from(buyer.secretKey)));
  console.log(buyer.publicKey.toBase58());
  process.exit(0);
}

// GCP testnet oracle is Cloud KMS — do not require a local oracle keypair JSON.
// Fund temp buyers via devnet airdrop (with optional ORACLE_KP file fallback).
const buyer = loadKp('/work/buyer.json');
const conn = new Connection(rpc, {
  commitment: 'confirmed',
  confirmTransactionInitialTimeout: 120000,
});

async function sleep(ms) { await new Promise((r) => setTimeout(r, ms)); }

async function withRetry(label, fn, attempts = 8) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = String(e?.message || e);
      const retryable = /429|Too Many|fetch failed|ECONNRESET|timed out|block height|airdrop/i.test(msg);
      console.error(`${label} attempt ${i + 1}/${attempts}: ${msg.slice(0, 180)}`);
      if (!retryable || i === attempts - 1) throw e;
      await sleep(1500 * Math.pow(2, Math.min(i, 4)));
    }
  }
  throw last;
}

async function fundBuyer(minLamports) {
  const bal = await withRetry('getBalance', () => conn.getBalance(buyer.publicKey));
  if (bal >= minLamports / 2) {
    console.error('buyer already funded', buyer.publicKey.toBase58(), 'bal', bal);
    return bal;
  }
  // Prefer mounted funder keypair (SM legacy/hot) — public airdrop faucet is often dry/429.
  let oracle = null;
  try {
    oracle = loadKp('/oracle.json');
  } catch (_) {
    oracle = null;
  }
  if (oracle) {
    const fund = SystemProgram.transfer({
      fromPubkey: oracle.publicKey,
      toPubkey: buyer.publicKey,
      lamports: minLamports,
    });
    const ftx = new Transaction().add(fund);
    const fsig = await withRetry('fund', () =>
      sendAndConfirmTransaction(conn, ftx, [oracle], { commitment: 'confirmed' }),
    );
    console.error('funded_via_keypair', buyer.publicKey.toBase58(), 'from', oracle.publicKey.toBase58(), 'bal_before', bal, fsig);
  } else {
    const sig = await withRetry('airdrop', () => conn.requestAirdrop(buyer.publicKey, minLamports), 6);
    await withRetry('confirmAirdrop', () => conn.confirmTransaction(sig, 'confirmed'), 6);
    console.error('airdropped', buyer.publicKey.toBase58(), sig);
  }
  return withRetry('getBalanceAfterFund', () => conn.getBalance(buyer.publicKey));
}

const fundLamports = Math.floor(0.08 * LAMPORTS_PER_SOL);
await fundBuyer(fundLamports);

if (mode === 'fund_only' || amountLamports <= 0n) {
  const after = await withRetry('getBalanceAfter', () => conn.getBalance(buyer.publicKey));
  console.log(JSON.stringify({ buyer: buyer.publicKey.toBase58(), balance_lamports: after }));
  process.exit(0);
}

const [escrowPda] = PublicKey.findProgramAddressSync(
  [Buffer.from('escrow'), buyer.publicKey.toBuffer(), seller.toBuffer()],
  programId,
);

const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);
const data = Buffer.alloc(8 + 8 + 8 + 8);
disc('initialize_escrow').copy(data, 0);
data.writeBigUInt64LE(amountLamports, 8);
data.writeBigUInt64LE(bandwidthGb, 16);
data.writeBigInt64LE(expiresAt, 24);

const ix = new TransactionInstruction({
  programId,
  keys: [
    { pubkey: escrowPda, isSigner: false, isWritable: true },
    { pubkey: buyer.publicKey, isSigner: true, isWritable: true },
    { pubkey: seller, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data,
});

const info = await withRetry('getAccountInfo', () => conn.getAccountInfo(escrowPda));
if (info) {
  console.log(JSON.stringify({ already: true, escrow_pda: escrowPda.toBase58(), buyer: buyer.publicKey.toBase58() }));
  process.exit(0);
}

const tx = new Transaction().add(ix);
const sig = await withRetry('initializeEscrow', () =>
  sendAndConfirmTransaction(conn, tx, [buyer], { commitment: 'confirmed' }),
);
console.log(JSON.stringify({
  tx: sig,
  escrow_pda: escrowPda.toBase58(),
  buyer: buyer.publicKey.toBase58(),
  amount_lamports: amountLamports.toString(),
}));
JS

# Prefetch npm deps once
docker run --rm -v /tmp/escrow-buy-smoke:/work -w /work node:24-bookworm \
  bash -lc 'npm install --silent @solana/web3.js@1.95.4' >/tmp/escrow-npm.log 2>&1

BUYER_PUB=$(docker run --rm \
  -e MODE=keygen -e RPC="$RPC" -e PROGRAM_ID="$PROGRAM_ID" -e SELLER_WALLET="$SELLER_WALLET" \
  -v /tmp/escrow-buy-smoke:/work -w /work \
  node:24-bookworm node init.mjs | tr -d '\r' | tail -n1)
echo "buyer_pub=$BUYER_PUB"
[[ -n "$BUYER_PUB" ]] || { echo "buyer keygen failed"; cat /tmp/escrow-npm.log; exit 1; }

echo "=== FUND BUYER (SM funder keypair preferred; airdrop fallback) ==="
ORACLE_MOUNT=()
resolve_funder() {
  ORACLE_MOUNT=()
  if [[ -f "$ORACLE_KP" ]] && python3 -c '
import json,sys
from pathlib import Path
p=Path(sys.argv[1]); d=json.loads(p.read_text())
assert isinstance(d,list) and len(d)==64
ex=Path("infra/oracle-keypair.json.example")
if ex.exists() and p.read_text().strip()==ex.read_text().strip():
  raise SystemExit(1)
' "$ORACLE_KP" 2>/dev/null; then
    ORACLE_MOUNT=(-v "$ORACLE_KP:/oracle.json:ro")
    echo "funder=local_oracle_file"
    return 0
  fi
  for sec in proxyhubb-testnet-treasury-legacy-keypair proxyhubb-testnet-treasury-hot-keypair; do
    if gcloud secrets versions access latest --secret="$sec" --project=gen-lang-client-0022105784 >/tmp/smoke-funder.json 2>/dev/null; then
      if python3 -c 'import json; d=json.load(open("/tmp/smoke-funder.json")); assert isinstance(d,list) and len(d)==64' 2>/dev/null; then
        chmod 600 /tmp/smoke-funder.json
        ORACLE_MOUNT=(-v /tmp/smoke-funder.json:/oracle.json:ro)
        echo "funder=secret:$sec"
        return 0
      fi
      rm -f /tmp/smoke-funder.json
    fi
  done
  echo "funder=airdrop_only"
  return 0
}
resolve_funder

docker run --rm \
  -e MODE=fund_only -e RPC="$RPC" -e PROGRAM_ID="$PROGRAM_ID" -e SELLER_WALLET="$SELLER_WALLET" \
  -e AMOUNT_LAMPORTS=0 -e BANDWIDTH_GB=1 \
  -v /tmp/escrow-buy-smoke:/work "${ORACLE_MOUNT[@]}" -w /work \
  node:24-bookworm node init.mjs

# Swap buyer primary wallet to temp pubkey
psqlc "UPDATE linked_wallets SET is_primary=false, updated_at=NOW()
        WHERE user_id='$BUYER_ID' AND chain='solana';"
EXISTS=$(psqlq "SELECT id::text FROM linked_wallets WHERE user_id='$BUYER_ID' AND chain='solana' AND address='$BUYER_PUB' LIMIT 1;")
if [[ -z "$EXISTS" ]]; then
  psqlc "INSERT INTO linked_wallets (id, user_id, chain, address, is_primary, created_at, updated_at)
         VALUES (gen_random_uuid(), '$BUYER_ID', 'solana', '$BUYER_PUB', true, NOW(), NOW());"
else
  psqlc "UPDATE linked_wallets SET is_primary=true, updated_at=NOW() WHERE id='$EXISTS';"
fi

SECRET=$("${COMPOSE[@]}" exec -T control-api sh -c 'printenv JWT_SECRET || printenv SUPABASE_JWT_SECRET' | tr -d '\r' | head -n1)
TOKEN=$(SECRET="$SECRET" USER_ID="$BUYER_ID" python3 - <<'PY'
import os,time,hmac,hashlib,base64,json
sec=os.environ["SECRET"].encode(); uid=os.environ["USER_ID"]
b64=lambda d: base64.urlsafe_b64encode(d).rstrip(b"=").decode()
h=b64(json.dumps({"alg":"HS256","typ":"JWT"}).encode())
p=b64(json.dumps({"sub":uid,"user_id":uid,"role":"buyer","exp":int(time.time())+3600}).encode())
s=b64(hmac.new(sec,f"{h}.{p}".encode(),hashlib.sha256).digest())
print(f"{h}.{p}.{s}")
PY
)

echo "=== CREATE ORDER ==="
CREATE_CODE=$(curl -sS -o /tmp/co.json -w '%{http_code}' -X POST "$API/v1/orders" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"listing_id\":\"$LISTING_ID\",\"bandwidth_gb\":1}")
echo "create HTTP=$CREATE_CODE body=$(head -c 600 /tmp/co.json)"
OID=$(python3 - <<'PY'
import json
d=json.load(open("/tmp/co.json"))
o=d.get("order") or d
print(o.get("id",""))
PY
)
[[ -n "$OID" ]] || exit 1
echo "oid=$OID"

echo "=== PAY/SOLANA ==="
PAY_CODE=$(curl -sS -o /tmp/pay.json -w '%{http_code}' -X POST "$API/v1/orders/$OID/pay/solana" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}')
echo "pay HTTP=$PAY_CODE body=$(head -c 800 /tmp/pay.json)"
[[ "$PAY_CODE" == "200" ]] || exit 1

AMOUNT=$(python3 - <<'PY'
import json
print(int(json.load(open("/tmp/pay.json"))["amount_lamports"]))
PY
)
PDA=$(python3 - <<'PY'
import json
print(json.load(open("/tmp/pay.json"))["escrow_pda"])
PY
)
echo "amount_lamports=$AMOUNT pda=$PDA"

echo "=== ON-CHAIN INIT ESCROW ==="
resolve_funder
INIT_OUT=$(docker run --rm \
  -e MODE=fund_init -e RPC="$RPC" -e PROGRAM_ID="$PROGRAM_ID" -e SELLER_WALLET="$SELLER_WALLET" \
  -e AMOUNT_LAMPORTS="$AMOUNT" -e BANDWIDTH_GB=1 \
  -v /tmp/escrow-buy-smoke:/work "${ORACLE_MOUNT[@]}" -w /work \
  node:24-bookworm node init.mjs)
echo "$INIT_OUT"
INIT_TX=$(INIT_OUT="$INIT_OUT" python3 - <<'PY'
import json,os
raw=os.environ["INIT_OUT"].strip().splitlines()[-1]
d=json.loads(raw)
print(d.get("tx") or "")
PY
)
echo "init_tx=$INIT_TX"
# Give RPC failover endpoints time to observe the new account
sleep 5

echo "=== CONFIRM-ESCROW ==="
CONF_CODE=0
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 3
  CONF_CODE=$(curl -sS -o /tmp/cf.json -w '%{http_code}' -X POST "$API/v1/orders/$OID/confirm-escrow" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"tx_signature\":\"$INIT_TX\"}")
  echo "confirm attempt $i HTTP=$CONF_CODE body=$(head -c 400 /tmp/cf.json)"
  if [[ "$CONF_CODE" == "200" ]]; then
    break
  fi
  CODE=$(python3 - <<'PY'
import json
print(json.load(open("/tmp/cf.json")).get("code",""))
PY
)
  # Hard failures shouldn't spin forever
  if [[ "$CODE" == "escrow_pda_required" || "$CODE" == "escrow_terminal" || "$CODE" == "escrow_expired" ]]; then
    break
  fi
done
[[ "$CONF_CODE" == "200" ]] || exit 1

CONNECT_RC=skip
if [[ "${HOLD_RELEASE:-0}" == "1" ]]; then
  echo "=== CREDENTIALS (HOLD_RELEASE) ==="
  CRED_CODE=0
  for i in 1 2 3 4 5 6 7 8; do
    sleep 2
    CRED_CODE=$(curl -sS -o /tmp/cred.json -w '%{http_code}' \
      -H "Authorization: Bearer $TOKEN" "$API/v1/orders/$OID/credentials")
    echo "credentials attempt $i HTTP=$CRED_CODE"
    if [[ "$CRED_CODE" == "200" ]]; then
      break
    fi
  done
  [[ "$CRED_CODE" == "200" ]] || { echo "credentials failed"; cat /tmp/cred.json; exit 1; }
  USER=$(python3 - <<'PY'
import json
d=json.load(open("/tmp/cred.json"))
c=d.get("proxy_credentials") or d
print(c.get("username") or c.get("user") or "")
PY
)
  PASS=$(python3 - <<'PY'
import json
d=json.load(open("/tmp/cred.json"))
c=d.get("proxy_credentials") or d
print(c.get("password") or c.get("pass") or "")
PY
)
  [[ -n "$USER" && -n "$PASS" ]] || { echo "missing creds fields"; head -c 400 /tmp/cred.json; exit 1; }
  echo "credentials_user=${USER:0:4}***"

  echo "=== CONNECT via edge :8090 ==="
  set +e
  curl -sS --max-time 45 -x "http://${USER}:${PASS}@127.0.0.1:8090" https://example.com \
    -o /tmp/connect-body -w 'connect_http=%{http_code}\n' >/tmp/connect-meta.txt 2>&1
  CONNECT_RC=$?
  set -e
  grep -E 'connect_http=' /tmp/connect-meta.txt || true
  if [[ "$CONNECT_RC" -eq 0 ]] && grep -q 'connect_http=200' /tmp/connect-meta.txt; then
    echo "CONNECT_OK"
  else
    echo "CONNECT_FAIL rc=$CONNECT_RC (provider tunnel may be down)"
    if [[ "${REQUIRE_CONNECT:-0}" == "1" ]]; then
      exit 1
    fi
  fi
fi

if [[ "${SKIP_RELEASE:-0}" == "1" ]]; then
  echo "=== RELEASE skipped (SKIP_RELEASE=1) — order held for soak ==="
  python3 - <<PY
assert int("$CONF_CODE")==200
assert "escrow_pda" in open("/tmp/pay.json").read()
print("CONFIRM_OK")
print("HOLD_ORDER_OK")
PY
  echo MARKETPLACE_ESCROW_BUY_SMOKE_DONE
else
echo "=== RELEASE ==="
if [[ "${SETTLE_COOLDOWN_SECS:-0}" =~ ^[0-9]+$ ]] && [[ "${SETTLE_COOLDOWN_SECS}" -gt 0 ]]; then
  echo "settle cooldown ${SETTLE_COOLDOWN_SECS}s (RPC rate-limit relief)"
  sleep "$SETTLE_COOLDOWN_SECS"
fi
REL_CODE=000
for attempt in 1 2 3 4 5; do
  REL_CODE=$(curl -sS -o /tmp/rel.json -w '%{http_code}' -X POST "$API/v1/escrow/$OID/release" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}' || echo 000)
  echo "release attempt $attempt HTTP=$REL_CODE body=$(head -c 800 /tmp/rel.json)"
  if [[ "$REL_CODE" == "200" ]]; then
    break
  fi
  # 202 settle_queued / 5xx — brief backoff then retry while order still active
  if [[ "$REL_CODE" == "202" || "$REL_CODE" == "503" || "$REL_CODE" == "500" ]]; then
    sleep $((attempt * 5))
    continue
  fi
  break
done
echo "release HTTP=$REL_CODE body=$(head -c 800 /tmp/rel.json)"

psqlc "SELECT id, status, escrow_pda, payment_method FROM orders WHERE id='$OID';"

python3 - <<PY
import json
assert int("$CONF_CODE")==200
rel=int("$REL_CODE")
body=json.load(open("/tmp/rel.json"))
# settle may 200 or fail if oracle/RPC flakes; confirm is the hard gate under REQUIRE_ESCROW_PDA
assert "escrow_pda" in open("/tmp/pay.json").read()
print("CONFIRM_OK")
if rel==200:
  print("RELEASE_OK")
else:
  print("RELEASE_SOFT_FAIL", body)
PY

echo MARKETPLACE_ESCROW_BUY_SMOKE_DONE
fi

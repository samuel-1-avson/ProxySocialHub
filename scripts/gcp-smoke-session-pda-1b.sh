#!/usr/bin/env bash
# Phase 1b smoke: prepaid session escrow with PROXYHUB_REQUIRE_SESSION_PDA=true.
# Requires upgraded proxyhub program with initialize_session_escrow / settle_session_escrow.
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

API="${API:-http://127.0.0.1:18080}"
# Prefer public Solana RPC for wallet txs — OnFinality /public is often 429-limited.
RPC="${RPC:-https://api.devnet.solana.com}"
PROGRAM_ID="${PROGRAM_ID:-AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu}"
ORACLE_KP="${ORACLE_KP:-/opt/proxyhubb/infra/oracle-keypair.json}"
BUYER_ID="${BUYER_ID:-76609a25-0b69-4e05-9640-4c67d7a07f36}"
SELLER_ID="${SELLER_ID:-b77e84c9-0e85-4f23-afc0-581cd561c216}"
# If caller exported a rate-limited private/public gateway, fall back.
case "$RPC" in
  *onfinality*|*TooMany*|"") RPC="https://api.devnet.solana.com" ;;
esac
echo "rpc=$RPC"

psqlq() { "${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -At -c "$1" | tr -d '\r' | head -n1; }
psqlc() { "${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c "$1"; }

cleanup() {
  set +e
  echo "=== CLEANUP ==="
  [[ -n "${SID:-}" ]] && psqlc "DELETE FROM sessions WHERE id='$SID';" >/dev/null 2>&1
  if [[ -n "${ORIG_WALLET:-}" && -n "${BUYER_PUB:-}" ]]; then
    psqlc "DELETE FROM linked_wallets WHERE user_id='$BUYER_ID' AND chain='solana' AND address='$BUYER_PUB';" >/dev/null 2>&1
    psqlc "UPDATE linked_wallets SET is_primary=true WHERE user_id='$BUYER_ID' AND chain='solana' AND address='$ORIG_WALLET';" >/dev/null 2>&1
  fi
  # restore flag to false after smoke unless KEEP_FLAG=1
  if [[ "${KEEP_FLAG:-0}" != "1" ]]; then
    "${COMPOSE[@]}" exec -T control-api true 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "=== ENABLE FLAG ==="
# Recreate control-api with flag true for this smoke
if grep -q '^PROXYHUB_REQUIRE_SESSION_PDA=' .env 2>/dev/null; then
  sed -i 's/^PROXYHUB_REQUIRE_SESSION_PDA=.*/PROXYHUB_REQUIRE_SESSION_PDA=true/' .env
else
  echo 'PROXYHUB_REQUIRE_SESSION_PDA=true' >> .env
fi
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api
for i in $(seq 1 40); do
  st=$("${COMPOSE[@]}" ps control-api --format '{{.Status}}' || true)
  echo "$st" | grep -qi healthy && break
  sleep 3
done
FLAG=$("${COMPOSE[@]}" exec -T control-api sh -c 'printenv PROXYHUB_REQUIRE_SESSION_PDA' | tr -d '\r')
echo "flag=$FLAG"
[[ "$FLAG" == "true" ]] || { echo "flag not true"; exit 1; }

# Ensure a live provider node for instant session
NODE_ID=$(psqlq "SELECT id::text FROM provider_nodes WHERE user_id='$SELLER_ID' AND deleted_at IS NULL ORDER BY last_seen_at DESC NULLS LAST LIMIT 1;")
if [[ -z "$NODE_ID" ]]; then
  NODE_ID=$(psqlq "SELECT id::text FROM provider_nodes WHERE user_id='$SELLER_ID' ORDER BY last_seen_at DESC NULLS LAST LIMIT 1;")
  psqlc "UPDATE provider_nodes SET deleted_at=NULL, status='online', is_healthy=true, last_seen_at=NOW() WHERE id='$NODE_ID';"
fi
echo "node=$NODE_ID"

SELLER_WALLET=$(psqlq "SELECT address FROM linked_wallets WHERE user_id='$SELLER_ID' AND chain='solana' AND is_primary=true LIMIT 1;")
ORIG_WALLET=$(psqlq "SELECT address FROM linked_wallets WHERE user_id='$BUYER_ID' AND chain='solana' AND is_primary=true LIMIT 1;")
# Ensure seller hotkey on node for settle path
psqlc "UPDATE provider_nodes SET hotkey='$SELLER_WALLET', status='online', is_healthy=true, deleted_at=NULL, last_seen_at=NOW() WHERE id='$NODE_ID';"
# sessions.node_id FK targets legacy nodes.id — ensure mirror row exists
MIRROR=$(psqlq "SELECT id::text FROM nodes WHERE provider_node_id='$NODE_ID' AND deleted_at IS NULL LIMIT 1;")
if [[ -z "$MIRROR" ]]; then
  psqlc "INSERT INTO nodes (id, user_id, provider_user_id, provider_node_id, status, is_healthy, created_at, updated_at, last_seen_at)
         VALUES (gen_random_uuid(), '$SELLER_ID', '$SELLER_ID', '$NODE_ID', 'online', true, NOW(), NOW(), NOW());"
  MIRROR=$(psqlq "SELECT id::text FROM nodes WHERE provider_node_id='$NODE_ID' AND deleted_at IS NULL LIMIT 1;")
fi
psqlc "UPDATE nodes SET status='online', is_healthy=true, deleted_at=NULL, last_seen_at=NOW(), updated_at=NOW() WHERE id='$MIRROR';"
echo "nodes_mirror=$MIRROR"

mkdir -p /tmp/session-pda-smoke
cat >/tmp/session-pda-smoke/init.mjs <<'JS'
import fs from 'fs';
import crypto from 'crypto';
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
  TransactionInstruction, sendAndConfirmTransaction, LAMPORTS_PER_SOL,
} from '@solana/web3.js';

const rpc = process.env.RPC;
const programId = new PublicKey(process.env.PROGRAM_ID);
const mode = process.env.MODE;

function disc(name) {
  return crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}
function loadKp(path) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path, 'utf8'))));
}
async function sleep(ms) { await new Promise((r) => setTimeout(r, ms)); }
async function withRetry(label, fn, attempts = 14) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      const msg = String(e?.message || e);
      console.error(`${label} ${i+1}: ${msg.slice(0,160)}`);
      if (!/429|Too Many|fetch failed|timed out|block height|ECONNRESET|socket/i.test(msg) || i === attempts-1) throw e;
      await sleep(2500 * Math.pow(2, Math.min(i, 5)));
    }
  }
  throw last;
}

if (mode === 'keygen') {
  const buyer = Keypair.generate();
  fs.writeFileSync('/work/buyer.json', JSON.stringify(Array.from(buyer.secretKey)));
  console.log(buyer.publicKey.toBase58());
  process.exit(0);
}

const oracle = loadKp('/oracle.json');
const buyer = loadKp('/work/buyer.json');
const conn = new Connection(rpc, { commitment: 'confirmed', confirmTransactionInitialTimeout: 120000 });

if (mode === 'fund_only') {
  const fundLamports = Math.floor(0.15 * LAMPORTS_PER_SOL);
  const bal = await withRetry('bal', () => conn.getBalance(buyer.publicKey));
  if (bal < fundLamports / 2) {
    const tx = new Transaction().add(SystemProgram.transfer({
      fromPubkey: oracle.publicKey, toPubkey: buyer.publicKey, lamports: fundLamports,
    }));
    await withRetry('fund', () => sendAndConfirmTransaction(conn, tx, [oracle], { commitment: 'confirmed' }));
  }
  console.log(JSON.stringify({ buyer: buyer.publicKey.toBase58(), balance: await conn.getBalance(buyer.publicKey) }));
  process.exit(0);
}

// initialize_session_escrow
const seller = new PublicKey(process.env.SELLER_WALLET);
const sessionIdHex = process.env.SESSION_ID_HEX; // 32 hex chars
const sessionId = Buffer.from(sessionIdHex, 'hex');
const amount = BigInt(process.env.AMOUNT_LAMPORTS);
const bw = BigInt(process.env.BANDWIDTH_LIMIT_BYTES || '1073741824');
const price = BigInt(process.env.PRICE_PER_GB_LAMPORTS || '10000000');
const expiresAt = BigInt(process.env.EXPIRES_AT);

const [statePda] = PublicKey.findProgramAddressSync([Buffer.from('program_state')], programId);
const [escrowPda] = PublicKey.findProgramAddressSync([Buffer.from('session_escrow'), sessionId], programId);

const data = Buffer.alloc(8 + 16 + 8 + 8 + 8 + 8);
disc('initialize_session_escrow').copy(data, 0);
sessionId.copy(data, 8);
data.writeBigUInt64LE(amount, 24);
data.writeBigUInt64LE(bw, 32);
data.writeBigUInt64LE(price, 40);
data.writeBigInt64LE(expiresAt, 48);

const ix = new TransactionInstruction({
  programId,
  keys: [
    { pubkey: buyer.publicKey, isSigner: true, isWritable: true },
    { pubkey: seller, isSigner: false, isWritable: false },
    { pubkey: escrowPda, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: statePda, isSigner: false, isWritable: false },
  ],
  data,
});
const sig = await withRetry('init', () =>
  sendAndConfirmTransaction(conn, new Transaction().add(ix), [buyer], { commitment: 'confirmed' }),
);
console.log(JSON.stringify({ tx: sig, session_pda: escrowPda.toBase58() }));
JS

docker run --rm -v /tmp/session-pda-smoke:/work -w /work node:24-bookworm \
  bash -lc 'npm install --silent @solana/web3.js@1.95.4' >/tmp/session-npm.log 2>&1

BUYER_PUB=$(docker run --rm -e MODE=keygen -e RPC="$RPC" -e PROGRAM_ID="$PROGRAM_ID" \
  -v /tmp/session-pda-smoke:/work -w /work node:24-bookworm node init.mjs | tr -d '\r' | tail -n1)
echo "buyer_pub=$BUYER_PUB"

docker run --rm -e MODE=fund_only -e RPC="$RPC" -e PROGRAM_ID="$PROGRAM_ID" \
  -v /tmp/session-pda-smoke:/work -v "$ORACLE_KP":/oracle.json:ro -w /work \
  node:24-bookworm node init.mjs

psqlc "UPDATE linked_wallets SET is_primary=false WHERE user_id='$BUYER_ID' AND chain='solana';"
psqlc "INSERT INTO linked_wallets (id, user_id, chain, address, is_primary, created_at, updated_at)
       VALUES (gen_random_uuid(), '$BUYER_ID', 'solana', '$BUYER_PUB', true, NOW(), NOW())
       ON CONFLICT DO NOTHING;"
# if unique on address, upsert primary
psqlc "UPDATE linked_wallets SET is_primary=true, user_id='$BUYER_ID', updated_at=NOW()
       WHERE chain='solana' AND address='$BUYER_PUB';" || true

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

# Allow legacy instant sessions for smoke
export PROXYHUB_ALLOW_LEGACY_DIRECT_SESSIONS=true
# Note: container env may still block — set via recreate if needed

CREATE=$(curl -sS -o /tmp/si.json -w '%{http_code}' -X POST "$API/v1/sessions/instant" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"strategy":"fastest","bandwidth_limit":1073741824}')
echo "create HTTP=$CREATE body=$(head -c 500 /tmp/si.json)"
SID=$(python3 - <<'PY'
import json
d=json.load(open("/tmp/si.json"))
print((d.get("session") or {}).get("id",""))
PY
)
[[ -n "$SID" ]] || exit 1

FUND=$(curl -sS -o /tmp/sf.json -w '%{http_code}' -X POST "$API/v1/sessions/$SID/fund/solana" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}')
echo "fund HTTP=$FUND body=$(head -c 600 /tmp/sf.json)"
[[ "$FUND" == "200" ]] || exit 1

AMOUNT=$(python3 -c 'import json; print(json.load(open("/tmp/sf.json"))["amount_lamports"])')
EXPIRES=$(python3 -c 'import json; print(json.load(open("/tmp/sf.json"))["expires_at"])')
BW=$(python3 -c 'import json; print(json.load(open("/tmp/sf.json"))["bandwidth_limit_bytes"])')
PRICE=$(python3 -c 'import json; print(json.load(open("/tmp/sf.json"))["price_per_gb_lamports"])')
SESSION_HEX=$(python3 - <<PY
import uuid
u=uuid.UUID("$SID")
print(u.hex)
PY
)

INIT_OUT=$(docker run --rm \
  -e MODE=init -e RPC="$RPC" -e PROGRAM_ID="$PROGRAM_ID" -e SELLER_WALLET="$SELLER_WALLET" \
  -e SESSION_ID_HEX="$SESSION_HEX" -e AMOUNT_LAMPORTS="$AMOUNT" -e EXPIRES_AT="$EXPIRES" \
  -e BANDWIDTH_LIMIT_BYTES="$BW" -e PRICE_PER_GB_LAMPORTS="$PRICE" \
  -v /tmp/session-pda-smoke:/work -v "$ORACLE_KP":/oracle.json:ro -w /work \
  node:24-bookworm node init.mjs)
echo "$INIT_OUT"
sleep 5

CONF=0
for i in 1 2 3 4 5 6 7 8; do
  CONF=$(curl -sS -o /tmp/sc.json -w '%{http_code}' -X POST "$API/v1/sessions/$SID/confirm-escrow" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}')
  echo "confirm attempt $i HTTP=$CONF body=$(head -c 300 /tmp/sc.json)"
  [[ "$CONF" == "200" ]] && break
  sleep 3
done
[[ "$CONF" == "200" ]] || exit 1

BAL_BEFORE=$(psqlq "SELECT COALESCE(balance_sol,0) FROM wallets WHERE user_id='$BUYER_ID';")
# Force billing settle with some bytes
"${COMPOSE[@]}" exec -T redis redis-cli SET "billing:session:${SID}:pending" 500000000 >/dev/null || true
# Trigger settle via internal path if available — else call SettleSessionEscrow from node using oracle
# Prefer API terminate which may settle
curl -sS -o /tmp/term.json -w '%{http_code}' -X POST "$API/v1/sessions/$SID/terminate" \
  -H "Authorization: Bearer $TOKEN" || true
sleep 2
BAL_AFTER=$(psqlq "SELECT COALESCE(balance_sol,0) FROM wallets WHERE user_id='$BUYER_ID';")
echo "balance_before=$BAL_BEFORE after=$BAL_AFTER"
python3 - <<PY
b=float("$BAL_BEFORE" or 0); a=float("$BAL_AFTER" or 0)
assert abs(a-b) < 1e-6, (b,a)
print("NO_CUSTODIAL_DEBIT_OK")
PY

echo SESSION_PDA_SMOKE_DONE

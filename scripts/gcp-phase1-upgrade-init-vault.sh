#!/usr/bin/env bash
# Fund oracle (airdrop + optional hot top-up), upgrade proxyhub, init vault, wire flags.
set -euo pipefail

PROGRAM_ID="${SOLANA_PROGRAM_ID:-AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu}"
SO_PATH="${SO_PATH:-/opt/proxyhubb/services/solana-programs/proxyhub/target/deploy/proxyhub.so}"
ORACLE_KP="${ORACLE_KP:-/opt/proxyhubb/infra/oracle-keypair.json}"
HOT_KP="${HOT_KP:-/opt/proxyhubb/secrets/treasury-hot-keypair.json}"
HOT="${HOT:-FeunrDoACmUi4fFQtiw3fPHAqB3N9UrAsj8ZzqSsGPa3}"
RPC="${RPC:-https://api.devnet.solana.com}"
VAULT_PDA="${VAULT_PDA:-8LZji2G9nn7ywoLwopgcREpm5xQHpvRJY1az1R9hHRzm}"
ROOT="${ROOT:-/opt/proxyhubb}"
NEED_SOL="${NEED_SOL:-8.0}"
# Buffer seed from the failed upgrade attempt (reclaim rent back to oracle).
BUFFER_SEED="${BUFFER_SEED:-return used actress omit bus ride great color immune copy danger found}"

sol() {
  sudo docker run --rm --network host \
    -v "$ORACLE_KP:/oracle.json:ro" \
    -v "$HOT_KP:/hot.json:ro" \
    -v /tmp:/tmp \
    --entrypoint solana \
    solanalabs/solana:v1.18.26 \
    "$@"
}

sol_keygen() {
  sudo docker run --rm \
    -v "$ORACLE_KP:/oracle.json:ro" \
    -v /tmp:/tmp \
    --entrypoint solana-keygen \
    solanalabs/solana:v1.18.26 \
    "$@"
}

balance_of() {
  sol balance "$1" --url "$RPC" | awk '{print $1}'
}

ge() {
  python3 -c "import sys; sys.exit(0 if float(sys.argv[1]) >= float(sys.argv[2]) else 1)" "$1" "$2"
}

ORACLE_PUB=$(sol_keygen pubkey /oracle.json)
echo "oracle=$ORACLE_PUB hot=$HOT"
echo "oracle_bal=$(balance_of "$ORACLE_PUB") hot_bal=$(balance_of "$HOT")"

echo "== reclaim failed-deploy buffer (if any) =="
if [[ -n "$BUFFER_SEED" ]]; then
  printf '%s\n' "$BUFFER_SEED" | sol_keygen recover --force /tmp/buffer-signer.json --outfile /tmp/buffer-signer.json 2>/dev/null \
    || printf '%s\n%s\n' "$BUFFER_SEED" "$BUFFER_SEED" | sol_keygen recover --force /tmp/buffer-signer.json 2>/dev/null \
    || true
  if [[ -f /tmp/buffer-signer.json ]]; then
    BUF_PUB=$(sol_keygen pubkey /tmp/buffer-signer.json || true)
    echo "buffer_signer=$BUF_PUB"
    sol --keypair /oracle.json program close "$BUF_PUB" --bypass-warning --url "$RPC" 2>/dev/null \
      || sol --keypair /oracle.json program close --buffers --url "$RPC" 2>/dev/null \
      || echo "no buffer to close (ok)"
  fi
fi
# Also close any leftover buffers owned by oracle
sol --keypair /oracle.json program close --buffers --url "$RPC" 2>/dev/null || true
echo "oracle_bal_after_close=$(balance_of "$ORACLE_PUB")"

echo "== airdrop oracle until >= $NEED_SOL =="
for i in 1 2 3 4 5 6 7 8 9 10; do
  bal=$(balance_of "$ORACLE_PUB")
  if ge "$bal" "$NEED_SOL"; then
    echo "funded_ok bal=$bal"
    break
  fi
  echo "airdrop attempt $i (bal=$bal)..."
  sol airdrop 2 "$ORACLE_PUB" --url "$RPC" || true
  sleep 4
done

bal=$(balance_of "$ORACLE_PUB")
if ! ge "$bal" "$NEED_SOL"; then
  echo "== airdrop short; transfer from hot =="
  test -f "$HOT_KP"
  hot_bal=$(balance_of "$HOT")
  xfer=$(python3 - <<PY
hot=float("$hot_bal")
need=float("$NEED_SOL")
oracle=float("$bal")
xfer=min(max(hot-0.25, 0.0), max(need-oracle+0.15, 0.0))
print(f"{xfer:.6f}")
PY
)
  echo "transfer $xfer SOL hot -> oracle"
  if python3 -c "import sys; sys.exit(0 if float(sys.argv[1]) > 0.01 else 1)" "$xfer"; then
    sol transfer --from /hot.json --keypair /hot.json "$ORACLE_PUB" "$xfer" \
      --url "$RPC" --allow-unfunded-recipient --fee-payer /hot.json
  fi
fi

bal=$(balance_of "$ORACLE_PUB")
echo "oracle_bal_after_fund=$bal"
if ! ge "$bal" "7.0"; then
  echo "STILL_UNDERFUNDED bal=$bal need>=7.0"
  exit 2
fi

echo "== upgrade =="
test -f "$SO_PATH"
cp -f "$SO_PATH" /tmp/proxyhub.so
sha256sum /tmp/proxyhub.so
sol program deploy \
  --url "$RPC" \
  --keypair /oracle.json \
  --program-id "$PROGRAM_ID" \
  --upgrade-authority /oracle.json \
  /tmp/proxyhub.so

echo "== program show =="
sol --keypair /oracle.json program show "$PROGRAM_ID" --url "$RPC"

echo "== initialize_deposit_vault =="
INIT_DIR=/tmp/init-vault-$$
mkdir -p "$INIT_DIR"
cat >"$INIT_DIR/package.json" <<'EOF'
{"type":"module","dependencies":{"@solana/web3.js":"^1.98.0"}}
EOF
cat >"$INIT_DIR/init.mjs" <<EOF
import fs from "fs";
import crypto from "crypto";
import {
  Connection, Keypair, PublicKey, SystemProgram,
  Transaction, TransactionInstruction, sendAndConfirmTransaction,
} from "@solana/web3.js";

const RPC = process.env.RPC;
const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID);
const HOT = new PublicKey(process.env.HOT);
const ORACLE_KP = process.env.ORACLE_KP;
const EXPECTED_VAULT = process.env.VAULT_PDA;

const secret = JSON.parse(fs.readFileSync(ORACLE_KP, "utf8"));
const payer = Keypair.fromSecretKey(Uint8Array.from(secret));
const [vaultPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("deposit_vault")],
  PROGRAM_ID,
);
const [programState] = PublicKey.findProgramAddressSync(
  [Buffer.from("program_state")],
  PROGRAM_ID,
);
if (vaultPda.toBase58() !== EXPECTED_VAULT) {
  throw new Error(\`vault PDA mismatch: got \${vaultPda.toBase58()} expected \${EXPECTED_VAULT}\`);
}

const disc = crypto.createHash("sha256")
  .update("global:initialize_deposit_vault")
  .digest()
  .subarray(0, 8);
const data = Buffer.concat([
  disc,
  HOT.toBuffer(),
  payer.publicKey.toBuffer(),
]);

const ix = new TransactionInstruction({
  programId: PROGRAM_ID,
  keys: [
    { pubkey: vaultPda, isSigner: false, isWritable: true },
    { pubkey: programState, isSigner: false, isWritable: false },
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data,
});

const conn = new Connection(RPC, "confirmed");
const info = await conn.getAccountInfo(vaultPda);
if (info) {
  console.log("VAULT_ALREADY_INITIALIZED", vaultPda.toBase58(), "lamports=", info.lamports);
  process.exit(0);
}

const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [payer], {
  commitment: "confirmed",
});
console.log("INIT_OK", sig);
console.log("VAULT", vaultPda.toBase58());
EOF

sudo docker run --rm \
  -v "$INIT_DIR:/work" \
  -v "$ORACLE_KP:/oracle.json:ro" \
  -e RPC="$RPC" \
  -e PROGRAM_ID="$PROGRAM_ID" \
  -e HOT="$HOT" \
  -e VAULT_PDA="$VAULT_PDA" \
  -e ORACLE_KP=/oracle.json \
  -w /work \
  node:24-bookworm \
  bash -lc 'npm install --silent && node init.mjs'

echo "== wire control-api env =="
cd "$ROOT"
set_env() {
  local key="$1" val="$2"
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${val}|" .env
  else
    echo "${key}=${val}" >> .env
  fi
}
set_env SOLANA_DEPOSIT_VAULT_ADDRESS "$VAULT_PDA"
set_env PROXYHUB_DEPOSIT_VAULT_CREDIT_ENABLED true
set_env PROXYHUB_DEPOSIT_LEGACY_TREASURY_CREDIT true
set_env PROXYHUB_DEPOSIT_VAULT_UI false
grep -E '^(SOLANA_DEPOSIT_VAULT_ADDRESS|PROXYHUB_DEPOSIT_VAULT_CREDIT_ENABLED|PROXYHUB_DEPOSIT_LEGACY_TREASURY_CREDIT|PROXYHUB_DEPOSIT_VAULT_UI)=' .env

echo "== recreate control-api =="
COMPOSE=(sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
"${COMPOSE[@]}" up -d --force-recreate --no-deps control-api
sleep 12
"${COMPOSE[@]}" ps control-api
curl -fsS http://127.0.0.1:8080/v1/system/config/public 2>/dev/null \
  || curl -fsS http://127.0.0.1:18080/v1/system/config/public 2>/dev/null \
  || true
echo
echo "oracle_bal_final=$(balance_of "$ORACLE_PUB") hot_bal_final=$(balance_of "$HOT")"
echo PHASE1_VAULT_DONE

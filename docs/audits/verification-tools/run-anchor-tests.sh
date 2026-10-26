#!/usr/bin/env bash
# Build the proxyhub workspace and run its Anchor TS tests against a local validator.
# /src is a read-only mount of services/solana-programs/proxyhub; all work happens in /work.
set -uo pipefail
export PATH=/opt/node/bin:/root/.local/share/solana/install/active_release/bin:/usr/local/cargo/bin:$PATH
OUT=/out
exec > >(tee $OUT/anchor-run.log) 2>&1

PROXYHUB_ID="AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu"
SESSION_ID="8TP21JyrghboxZqXMozx2sVzrDrNSZyN2hkf1D7dQGmb"

mkdir -p /work
tar -C /src --exclude=./target --exclude=./node_modules --exclude=./test-ledger -cf - . | tar -C /work -xf -
cd /work
# Windows checkouts can carry CRLF; make shell/TOML consumers happy.
find . -maxdepth 2 -name '*.sh' -exec sed -i 's/\r$//' {} + || true

echo "== versions"; node --version; solana --version; anchor --version; cargo --version

echo "== anchor build"
if ! anchor build 2>&1 | tail -40; then echo "ANCHOR_BUILD_FAILED"; fi
ls -la target/deploy/ || true
if [ ! -f target/deploy/proxyhub.so ]; then echo "NO_PROXYHUB_SO"; echo "ANCHOR_RUN_EXIT=2"; exit 2; fi

echo "== npm ci"
npm ci --no-audit --no-fund 2>&1 | tail -3

mkdir -p /root/.config/solana
[ -f /root/.config/solana/id.json ] || solana-keygen new --no-bip39-passphrase --force -o /root/.config/solana/id.json >/dev/null

echo "== validator"
solana-test-validator --reset --quiet \
  --bpf-program "$PROXYHUB_ID" target/deploy/proxyhub.so \
  --bpf-program "$SESSION_ID" target/deploy/session.so > /tmp/validator.log 2>&1 &
VPID=$!
trap 'kill $VPID 2>/dev/null || true' EXIT
for _ in $(seq 1 120); do
  if curl -s http://127.0.0.1:8899/health 2>/dev/null | grep -q ok; then break; fi
  sleep 1
done
curl -s http://127.0.0.1:8899/health; echo

export ANCHOR_PROVIDER_URL=http://127.0.0.1:8899
export ANCHOR_WALLET=/root/.config/solana/id.json
echo "== mocha: ${MOCHA_GLOB:-tests/**/*.ts}"
npx ts-mocha -p ./tsconfig.json -t 1000000 "${MOCHA_GLOB:-tests/**/*.ts}"
RC=$?
echo "ANCHOR_RUN_EXIT=$RC"
exit $RC

#!/usr/bin/env bash
# Runs the Anchor TS test suite against a local solana-test-validator.
# Expects target/deploy/*.so to exist (run anchor build first).
set -euxo pipefail

NODE_VERSION="${NODE_VERSION:-24.10.0}"
SOLANA_VERSION="${SOLANA_VERSION:-v2.3.0}"
MOCHA_GLOB="${MOCHA_GLOB:-tests/**/*.ts}"
PROXYHUB_ID="AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu"
SESSION_ID="8TP21JyrghboxZqXMozx2sVzrDrNSZyN2hkf1D7dQGmb"

if ! command -v node >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y --no-install-recommends curl ca-certificates xz-utils bzip2 libudev-dev libssl-dev
  mkdir -p /opt/node
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" -o /tmp/node.tar.xz
  tar -xJf /tmp/node.tar.xz -C /opt/node --strip-components=1
  export PATH="/opt/node/bin:$PATH"
fi

if ! command -v solana-test-validator >/dev/null 2>&1; then
  curl -sSfL "https://release.anza.xyz/${SOLANA_VERSION}/install" | bash
  export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
fi

node --version
solana --version

mkdir -p /root/.config/solana
if [ ! -f /root/.config/solana/id.json ]; then
  solana-keygen new --no-bip39-passphrase --force -o /root/.config/solana/id.json >/dev/null
fi

cd /workspace
npm ci --no-audit --no-fund

solana-test-validator --reset --quiet \
  --bpf-program "${PROXYHUB_ID}" target/deploy/proxyhub.so \
  --bpf-program "${SESSION_ID}" target/deploy/session.so &
VALIDATOR_PID=$!
cleanup() { kill "${VALIDATOR_PID}" 2>/dev/null || true; }
trap cleanup EXIT

echo "Waiting for validator RPC..."
for _ in $(seq 1 90); do
  if curl -s http://127.0.0.1:8899/health 2>/dev/null | grep -q ok; then break; fi
  sleep 1
done
curl -s http://127.0.0.1:8899/health

export ANCHOR_PROVIDER_URL=http://127.0.0.1:8899
export ANCHOR_WALLET=/root/.config/solana/id.json
npx ts-mocha -p ./tsconfig.json -t 1000000 "${MOCHA_GLOB}"

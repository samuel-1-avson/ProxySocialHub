#!/usr/bin/env bash
set -euo pipefail

retry() {
  local attempts="$1"
  shift
  local attempt=1
  until "$@"; do
    if [ "$attempt" -ge "$attempts" ]; then
      return 1
    fi
    attempt=$((attempt + 1))
    echo "Retry ${attempt}/${attempts}..." >&2
  done
}

export DEBIAN_FRONTEND=noninteractive
export PATH="/usr/local/cargo/bin:$HOME/.cargo/bin:$PATH"
export CARGO_NET_RETRY=10
export CARGO_NET_GIT_FETCH_WITH_CLI=true
export CARGO_HTTP_TIMEOUT=600
export CARGO_HTTP_MULTIPLEXING=false
export CARGO_HTTP_LOW_SPEED_LIMIT=1
export CARGO_REGISTRIES_CRATES_IO_PROTOCOL=sparse

retry 3 bash -lc 'apt-get update'
retry 3 bash -lc 'apt-get install -y --no-install-recommends curl git pkg-config libssl-dev libudev-dev ca-certificates build-essential xz-utils'

export PATH="/opt/node/bin:/usr/local/cargo/bin:$HOME/.cargo/bin:$HOME/.avm/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

if [ ! -x /opt/node/bin/node ]; then
  retry 3 bash -lc 'mkdir -p /opt/node && curl -fsSL https://nodejs.org/dist/v24.10.0/node-v24.10.0-linux-x64.tar.xz -o /tmp/node.tar.xz && tar -xJf /tmp/node.tar.xz -C /opt/node --strip-components=1'
  npm install -g yarn || true
fi
if [ ! -x "$HOME/.local/share/solana/install/active_release/bin/solana" ]; then
  retry 3 bash -lc 'curl -sSfL https://release.anza.xyz/v2.3.0/install | bash'
fi
if [ ! -x "$HOME/.avm/bin/anchor-0.32.1" ]; then
  retry 3 cargo install --git https://github.com/solana-foundation/anchor --tag v0.32.1 avm --force
  retry 3 avm install 0.32.1
fi
mkdir -p /usr/local/cargo/bin
ln -sf "$HOME/.avm/bin/anchor-0.32.1" /usr/local/cargo/bin/anchor
avm use 0.32.1 2>/dev/null || true
export PATH="/opt/node/bin:/usr/local/cargo/bin:$HOME/.cargo/bin:$HOME/.avm/bin:/opt/node/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
node --version || true
cargo --version
solana --version
anchor --version
which cargo-build-sbf || true

cd /workspace

# Platform-tools cargo is still 1.84 and cannot parse edition2024 crate manifests.
pin() { cargo update -p "$1" --precise "$2" || true; }
pin blake3 1.8.2
pin constant_time_eq 0.3.1
pin indexmap 2.11.4
pin cpufeatures 0.2.17
pin crypto-common 0.1.7
pin enum-ordinalize@4.4.2 4.3.2
pin enum-ordinalize-derive@4.4.2 4.3.2
pin zeroize_derive 1.4.2
pin zeroize 1.8.1
pin thiserror@2.0.18 2.0.12
pin zerocopy@0.8.33 0.8.26


# Compile off the NTFS bind-mount (native ld hung there). Copy the ELF back.
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-/tmp/proxyhub-sbf}"
FEATURES="${PROXYHUB_BUILD_FEATURES:-onchain-groth16}"
echo "anchor build -p proxyhub --no-idl -- --features ${FEATURES}"
echo "CARGO_TARGET_DIR=${CARGO_TARGET_DIR}"
anchor build -p proxyhub --no-idl -- --features "${FEATURES}"
mkdir -p /workspace/target/deploy
cp -f "${CARGO_TARGET_DIR}/deploy/proxyhub.so" /workspace/target/deploy/proxyhub.so
ls -la /workspace/target/deploy/proxyhub.so
sha256sum /workspace/target/deploy/proxyhub.so
grep -aq "Listing commitment registered" /workspace/target/deploy/proxyhub.so || {
  echo "FAIL: proxyhub.so lacks ListingCommitment marker" >&2
  exit 1
}
grep -aq "Groth16" /workspace/target/deploy/proxyhub.so || {
  echo "FAIL: proxyhub.so lacks Groth16; refuse live-shaped artifact" >&2
  exit 1
}
echo BUILD_OK
echo W9A_SO_LISTING_AND_GROTH16_OK

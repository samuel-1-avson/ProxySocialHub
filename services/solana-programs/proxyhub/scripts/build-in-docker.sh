#!/usr/bin/env bash
# In-container build for the proxyhub Anchor program (Windows hosts cannot
# build the IDL: openssl-sys needs perl). Mirrors build-anchor-docker.ps1 but
# runs from a script file to avoid PowerShell argument mangling.
set -euo pipefail

# bash -lc in this image starts with an empty PATH — restore toolchain paths.
export PATH="/opt/node/bin:/usr/local/cargo/bin:/usr/local/bin:/usr/bin:/bin:$HOME/.cargo/bin:$HOME/.avm/bin"

NODE_VERSION="${NODE_VERSION:-24.10.0}"
SOLANA_VERSION="${SOLANA_VERSION:-v2.3.0}"
ANCHOR_VERSION="${ANCHOR_VERSION:-0.32.1}"

retry() {
  local attempts="$1"; shift
  local attempt=1
  until "$@"; do
    if [ "$attempt" -ge "$attempts" ]; then return 1; fi
    attempt=$((attempt + 1))
    echo "Retry ${attempt}/${attempts}..." >&2
  done
}

export DEBIAN_FRONTEND=noninteractive
retry 3 apt-get update
retry 3 apt-get install -y --no-install-recommends curl git pkg-config libssl-dev libudev-dev ca-certificates build-essential xz-utils

if ! command -v node >/dev/null 2>&1; then
  retry 3 rm -rf /opt/node
  mkdir -p /opt/node
  retry 3 curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" -o /tmp/node.tar.xz
  tar -xJf /tmp/node.tar.xz -C /opt/node --strip-components=1
fi
export PATH="/opt/node/bin:$PATH"

if ! command -v solana >/dev/null 2>&1; then
  rm -rf "$HOME/.local/share/solana"
  retry 3 bash -c "curl -sSfL https://release.anza.xyz/${SOLANA_VERSION}/install | bash"
fi
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

export CARGO_NET_RETRY=10
export CARGO_NET_GIT_FETCH_WITH_CLI=true
export CARGO_HTTP_TIMEOUT=600
export CARGO_HTTP_MULTIPLEXING=false
export CARGO_HTTP_LOW_SPEED_LIMIT=1
export CARGO_REGISTRIES_CRATES_IO_PROTOCOL=sparse

if ! command -v avm >/dev/null 2>&1; then
  retry 3 cargo install --git https://github.com/solana-foundation/anchor --tag "v${ANCHOR_VERSION}" avm --force
fi
export PATH="$HOME/.cargo/bin:$HOME/.avm/bin:$PATH"
if ! command -v anchor >/dev/null 2>&1; then
  retry 3 avm install "$ANCHOR_VERSION"
  avm use "$ANCHOR_VERSION"
fi

node --version
solana --version
anchor --version

cd /workspace
npm ci --no-audit --no-fund
anchor build
echo BUILD_IN_DOCKER_DONE

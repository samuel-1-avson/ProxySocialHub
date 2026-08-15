#!/usr/bin/env bash
# Docker SBF build for programs/gateway-bond (Wave 8 / P0.4).
# Groth16-irrelevant: same edition2024 crate pins as proxyhub SBF (platform-tools
# cargo 1.84 cannot parse newer manifests). Not programs/session.
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
export PATH="/usr/local/cargo/bin:$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
export CARGO_NET_RETRY=10
export CARGO_NET_GIT_FETCH_WITH_CLI=true
export CARGO_HTTP_TIMEOUT=600
export CARGO_HTTP_MULTIPLEXING=false
export CARGO_HTTP_LOW_SPEED_LIMIT=1
export CARGO_REGISTRIES_CRATES_IO_PROTOCOL=sparse

retry 3 bash -lc 'apt-get update'
retry 3 bash -lc 'apt-get install -y --no-install-recommends curl git pkg-config libssl-dev libudev-dev ca-certificates build-essential xz-utils'

if [ ! -x "$HOME/.local/share/solana/install/active_release/bin/solana" ]; then
  retry 3 bash -lc 'curl -sSfL https://release.anza.xyz/v2.3.0/install | bash'
fi
export PATH="$HOME/.local/share/solana/install/active_release/bin:/usr/local/cargo/bin:$HOME/.cargo/bin:$PATH"
solana --version
cargo --version
which cargo-build-sbf

cd /workspace/programs/gateway-bond

# Platform-tools cargo is still 1.84 and cannot parse edition2024 crate manifests.
# gateway-bond is Anchor 0.30.1 / solana-program 1.18.26 — do NOT pin zeroize 1.8.1
# (curve25519-dalek 3.2.1 requires zeroize < 1.4).
#
# solana-program-test / solana-sdk (dev-dependencies) pull indexmap 2.14 (edition2024).
# Strip them for the SBF compile only; restore afterwards so localnet soak still builds.
# Persist backups on the bind-mount so docker kill cannot drop the test lockfile.
BAK_DIR=/workspace/programs/gateway-bond/.sbf-bak
mkdir -p "$BAK_DIR"
if grep -q 'solana-program-test' Cargo.lock 2>/dev/null; then
  cp Cargo.toml "$BAK_DIR/Cargo.toml"
  cp Cargo.lock "$BAK_DIR/Cargo.lock"
fi
cp Cargo.toml /tmp/gateway-bond-Cargo.toml.bak
cp Cargo.lock /tmp/gateway-bond-Cargo.lock.bak
restore_manifest() {
  if [[ -f "$BAK_DIR/Cargo.lock" ]]; then
    cp "$BAK_DIR/Cargo.toml" /workspace/programs/gateway-bond/Cargo.toml
    cp "$BAK_DIR/Cargo.lock" /workspace/programs/gateway-bond/Cargo.lock
  else
    cp /tmp/gateway-bond-Cargo.toml.bak /workspace/programs/gateway-bond/Cargo.toml
    cp /tmp/gateway-bond-Cargo.lock.bak /workspace/programs/gateway-bond/Cargo.lock
  fi
}
trap restore_manifest EXIT
awk '/^\[dev-dependencies\]/{skip=1; next} /^\[/{skip=0} skip==0{print}' Cargo.toml > /tmp/Cargo.toml.sbf
cp /tmp/Cargo.toml.sbf Cargo.toml
rm -f Cargo.lock

do_pins() {
  pin() { cargo update -p "$1" --precise "$2" || true; }
  pin blake3 1.8.2
  pin constant_time_eq 0.3.1
  pin proc-macro-crate@3.5.0 3.2.0
  pin indexmap@2.14.0 2.11.4
  pin zerocopy@0.8.56 0.8.26
  pin zerocopy-derive@0.8.56 0.8.26
  pin cc@1.4.2 1.2.16
  pin zeroize_derive 1.4.2
  pin jobserver@0.1.35 0.1.32
  pin unicode-segmentation@1.13.3 1.12.0
}

mkdir -p target/deploy
if [[ -f keys/proxy_gateway_bond-keypair.json ]]; then
  cp -f keys/proxy_gateway_bond-keypair.json target/deploy/proxy_gateway_bond-keypair.json
fi

export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-/tmp/gateway-bond-sbf}"
# Host cargo 1.89 can parse edition2024 manifests; pin them down before cargo-build-sbf (1.84).
cargo generate-lockfile
do_pins
echo "cargo-build-sbf CARGO_TARGET_DIR=${CARGO_TARGET_DIR} (no solana-program-test graph)"
if ! cargo-build-sbf -- --ignore-rust-version; then
  echo "retry pins + cargo-build-sbf" >&2
  do_pins
  cargo-build-sbf -- --ignore-rust-version
fi
mkdir -p /workspace/programs/gateway-bond/target/deploy
cp -f "${CARGO_TARGET_DIR}/deploy/proxy_gateway_bond.so" /workspace/programs/gateway-bond/target/deploy/proxy_gateway_bond.so
if [[ -f "${CARGO_TARGET_DIR}/deploy/proxy_gateway_bond-keypair.json" ]]; then
  cp -f "${CARGO_TARGET_DIR}/deploy/proxy_gateway_bond-keypair.json" /workspace/programs/gateway-bond/target/deploy/proxy_gateway_bond-keypair.json || true
fi
ls -la /workspace/programs/gateway-bond/target/deploy/proxy_gateway_bond.so
sha256sum /workspace/programs/gateway-bond/target/deploy/proxy_gateway_bond.so
grep -aq "gateway-bond config init deploy_allowed=false" /workspace/programs/gateway-bond/target/deploy/proxy_gateway_bond.so || {
  echo "FAIL: .so lacks initialize marker" >&2
  exit 1
}
grep -aq "8TP21JyrghboxZqXMozx2sVzrDrNSZyN2hkf1D7dQGmb" /workspace/programs/gateway-bond/target/deploy/proxy_gateway_bond.so && {
  echo "FAIL: .so must not embed programs/session id" >&2
  exit 1
}
echo W8_GATEWAY_BOND_SBF_OK

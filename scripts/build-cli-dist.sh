#!/usr/bin/env bash
# Build provider-node binaries into cli-dist/<version>/ for API distribution.
# Linux/macOS counterpart to rebuild-cli.ps1 (CI and VPS builds).
#
# Usage:
#   ./scripts/build-cli-dist.sh
#   ./scripts/build-cli-dist.sh --all
#   CLI_DIST_VERSION=1.2.3 ./scripts/build-cli-dist.sh --all

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${CLI_DIST_VERSION:-1.0.0}"
DIST_DIR="$REPO_ROOT/cli-dist/$VERSION"
NODE_DIR="$REPO_ROOT/services/provider-node"
BUILD_ALL=0

for arg in "$@"; do
  case "$arg" in
    --all) BUILD_ALL=1 ;;
    -h|--help)
      echo "Usage: $0 [--all]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

cargo_target() {
  local goos="$1" goarch="$2"
  case "${goos}/${goarch}" in
    linux/amd64) echo "x86_64-unknown-linux-gnu" ;;
    linux/arm64) echo "aarch64-unknown-linux-gnu" ;;
    macos/amd64) echo "x86_64-apple-darwin" ;;
    macos/arm64) echo "aarch64-apple-darwin" ;;
    *) echo "unsupported: ${goos}/${goarch}" >&2; return 1 ;;
  esac
}

build_provider_node() {
  local goos="$1" goarch="$2" out_name="$3"
  local target built dest
  target="$(cargo_target "$goos" "$goarch")"
  echo "Building $out_name ($goos/$goarch)..."
  rustup target add "$target" >/dev/null 2>&1 || true
  (
    cd "$NODE_DIR"
    cargo build --release --target "$target"
  )
  if [[ "$goos" == "windows" ]]; then
    built="$NODE_DIR/target/$target/release/provider-node.exe"
  else
    built="$NODE_DIR/target/$target/release/provider-node"
  fi
  if [[ ! -f "$built" ]]; then
    echo "Binary not found: $built" >&2
    exit 1
  fi
  dest="$DIST_DIR/$out_name"
  cp -f "$built" "$dest"
  chmod +x "$dest" 2>/dev/null || true
  echo "  -> $out_name"
}

mkdir -p "$DIST_DIR"

# Always build native linux amd64 on CI runners.
build_provider_node linux amd64 "provider-node-${VERSION}-linux-amd64"

if [[ "$BUILD_ALL" -eq 1 ]]; then
  build_provider_node linux arm64 "provider-node-${VERSION}-linux-arm64"
  build_provider_node macos amd64 "provider-node-${VERSION}-macos-amd64"
  build_provider_node macos arm64 "provider-node-${VERSION}-macos-arm64"
fi

echo ""
echo "Done. Binaries in $DIST_DIR"
echo "Restart control-api (or wait for SeedCLIDownloads) to refresh cli_downloads."

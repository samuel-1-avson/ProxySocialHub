#!/usr/bin/env bash
# Build provider-node + proxyhubb-cli binaries into cli-dist/<version>/ for API distribution.
# Windows is built via rebuild-cli.ps1 on windows-latest (see CI), not cross-compiled here.
# Usage:
#   ./scripts/build-cli-dist.sh
#   ./scripts/build-cli-dist.sh --all   # linux arm64 + macos (native/cross as available)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${CLI_DIST_VERSION:-1.0.6}"
DIST_DIR="$REPO_ROOT/cli-dist/$VERSION"
NODE_DIR="$REPO_ROOT/services/provider-node"
CLI_DIR="$REPO_ROOT/cli"
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

build_crate() {
  local crate_dir="$1" bin_name="$2" goos="$3" goarch="$4" out_name="$5"
  local target built dest
  target="$(cargo_target "$goos" "$goarch")"
  echo "Building $out_name ($goos/$goarch)..."
  rustup target add "$target" >/dev/null 2>&1 || true
  (
    cd "$crate_dir"
    cargo build --release --target "$target"
  )
  if [[ "$goos" == "windows" ]]; then
    built="$crate_dir/target/$target/release/${bin_name}.exe"
  else
    built="$crate_dir/target/$target/release/${bin_name}"
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

# Always build native linux amd64 on CI runners (daemon + join wrapper).
build_crate "$NODE_DIR" provider-node linux amd64 "provider-node-${VERSION}-linux-amd64"
build_crate "$CLI_DIR" proxyhubb-cli linux amd64 "provider-cli-${VERSION}-linux-amd64"

if [[ "$BUILD_ALL" -eq 1 ]]; then
  build_crate "$NODE_DIR" provider-node linux arm64 "provider-node-${VERSION}-linux-arm64"
  build_crate "$CLI_DIR" proxyhubb-cli linux arm64 "provider-cli-${VERSION}-linux-arm64"
  build_crate "$NODE_DIR" provider-node macos amd64 "provider-node-${VERSION}-macos-amd64"
  build_crate "$CLI_DIR" proxyhubb-cli macos amd64 "provider-cli-${VERSION}-macos-amd64"
  build_crate "$NODE_DIR" provider-node macos arm64 "provider-node-${VERSION}-macos-arm64"
  build_crate "$CLI_DIR" proxyhubb-cli macos arm64 "provider-cli-${VERSION}-macos-arm64"
fi

echo ""
echo "Done. Binaries in $DIST_DIR"
ls -la "$DIST_DIR"

param(
    [string]$Image = "rust:1.89-bookworm",
    [string]$AnchorVersion = "0.32.1",
    [string]$SolanaVersion = "v2.1.18",
    [switch]$SkipNpmInstall
)

$ErrorActionPreference = "Stop"

$workspace = (Resolve-Path $PSScriptRoot).ProviderPath
$dockerWorkspace = $workspace -replace "\\", "/"

$steps = @(
    "set -euo pipefail",
    'retry() { local attempts="$1"; shift; local attempt=1; until "$@"; do if [ "$attempt" -ge "$attempts" ]; then return 1; fi; attempt=$((attempt+1)); echo "Retry ${attempt}/${attempts}..." >&2; done; }',
    "export DEBIAN_FRONTEND=noninteractive",
    "apt-get update",
    "apt-get install -y curl git pkg-config libssl-dev libudev-dev nodejs npm ca-certificates build-essential",
    ('retry 3 bash -lc ''rm -rf "$HOME/.local/share/solana"; curl -sSfL https://release.anza.xyz/{0}/install | bash''' -f $SolanaVersion),
    'export PATH="$HOME/.local/share/solana/install/active_release/bin:/usr/local/cargo/bin:$HOME/.cargo/bin:$PATH"',
    "export CARGO_NET_RETRY=10",
    "npm install -g yarn",
    "cargo --version",
    "cargo install --git https://github.com/solana-foundation/anchor --tag v$AnchorVersion anchor-cli --locked --force",
    "solana --version",
    "anchor --version"
)

if (-not $SkipNpmInstall) {
    $steps += "npm ci"
}

$steps += "anchor build"

$bashCommand = $steps -join "; "

$dockerArgs = @(
    "run",
    "--rm",
    "-v",
    "${dockerWorkspace}:/workspace",
    "-w",
    "/workspace",
    $Image,
    "bash",
    "-lc",
    $bashCommand
)

& docker @dockerArgs
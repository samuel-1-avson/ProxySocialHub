param(
    [string]$Image = "rust:1.89-trixie",
    [string]$AnchorVersion = "0.32.1",
    [string]$SolanaVersion = "v2.3.0",
    [string]$NodeVersion = "24.10.0",
    [string]$AnchorCommand = "anchor build",
    [switch]$SkipNpmInstall
)

$ErrorActionPreference = "Stop"

$workspace = (Resolve-Path $PSScriptRoot).ProviderPath
$dockerWorkspace = $workspace -replace "\\", "/"

$steps = @(
    "set -euo pipefail",
    'retry() { local attempts="$1"; shift; local attempt=1; until "$@"; do if [ "$attempt" -ge "$attempts" ]; then return 1; fi; attempt=$((attempt+1)); echo "Retry ${attempt}/${attempts}..." >&2; done; }',
    "export DEBIAN_FRONTEND=noninteractive",
    'retry 3 bash -lc ''apt-get update''',
    'retry 3 bash -lc ''apt-get install -y --no-install-recommends curl git pkg-config libssl-dev libudev-dev ca-certificates build-essential xz-utils''',
    ('retry 3 bash -lc ''rm -rf /opt/node && mkdir -p /opt/node && curl -fsSL https://nodejs.org/dist/v{0}/node-v{0}-linux-x64.tar.xz -o /tmp/node.tar.xz && tar -xJf /tmp/node.tar.xz -C /opt/node --strip-components=1''' -f $NodeVersion),
    ('retry 3 bash -lc ''rm -rf "$HOME/.local/share/solana"; curl -sSfL https://release.anza.xyz/{0}/install | bash''' -f $SolanaVersion),
    'export PATH="/opt/node/bin:$HOME/.local/share/solana/install/active_release/bin:/usr/local/cargo/bin:$HOME/.cargo/bin:$PATH"',
    "export CARGO_NET_RETRY=10",
    "export CARGO_NET_GIT_FETCH_WITH_CLI=true",
    "export CARGO_HTTP_TIMEOUT=600",
    "export CARGO_HTTP_MULTIPLEXING=false",
    "export CARGO_HTTP_LOW_SPEED_LIMIT=1",
    "export CARGO_REGISTRIES_CRATES_IO_PROTOCOL=sparse",
    "npm install -g yarn",
    "node --version",
    "npm --version",
    "cargo --version",
    "retry 3 cargo install --git https://github.com/solana-foundation/anchor --tag v$AnchorVersion avm --force",
    'export PATH="$HOME/.cargo/bin:$HOME/.avm/bin:$PATH"',
    "avm --version",
    "retry 3 avm install $AnchorVersion",
    "avm use $AnchorVersion",
    "solana --version",
    "anchor --version"
)

if (-not $SkipNpmInstall) {
    $steps += "npm ci"
}

$steps += $AnchorCommand

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
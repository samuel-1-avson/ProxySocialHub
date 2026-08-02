param(
    [string]$Image = "rust:1.89-trixie",
    [string]$MochaGlob = "tests/**/*.ts"
)

# Runs the Anchor TS test suite against a local solana-test-validator inside
# Docker (the host Windows validator cannot create symlinks). Requires
# target/deploy/*.so to already exist — build first with:
#   .\build-anchor-docker.ps1   (or native `anchor build`)

$ErrorActionPreference = "Stop"
# Avoid Cursor sandbox CARGO_TARGET_DIR hijacking host builds used for *.so artifacts.
Remove-Item Env:CARGO_TARGET_DIR -ErrorAction SilentlyContinue
$workspace = (Resolve-Path $PSScriptRoot).ProviderPath
$dockerWorkspace = $workspace -replace "\\", "/"
$env:CARGO_TARGET_DIR = Join-Path $workspace "target"

$env:MOCHA_GLOB = $MochaGlob

# Invoke the checked-in script inside the container; strip CRLF first so a
# Windows-saved checkout cannot break bash parsing.
$dockerArgs = @(
    "run", "--rm",
    "-e", "MOCHA_GLOB",
    "-v", "${dockerWorkspace}:/workspace",
    "-w", "/workspace",
    $Image,
    "bash", "-lc", "sed -i 's/\r$//' scripts/run-local-tests.sh && bash scripts/run-local-tests.sh"
)

& docker @dockerArgs

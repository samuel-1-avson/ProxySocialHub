# Wave 11.C — accuse + wait 3600s + resolve_release on devnet.
# Prefer release. Never resolve_slash. Never arm GCP slash gates.
# Never programs/session. Never mainnet. live_economic_slash stays false.
#
#   $env:CONFIRM_W11C_RELEASE_SOAK = "1"
#   powershell -File scripts/w11c-devnet-release-soak.ps1
#
# Runtime is a little over one hour (challenge window). Ctrl+C is safe after
# accuse; resume with the same confirm env (already_open → wait → release).

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ApiDir = Join-Path $Root "services\control-api"

if ($env:CONFIRM_W11C_RELEASE_SOAK -ne "1") {
    throw "REFUSE: set CONFIRM_W11C_RELEASE_SOAK=1 (accuse + wait + resolve_release; never slash)"
}
if ($env:CONFIRM_W8_DEPLOY -eq "1") {
    throw "REFUSE: CONFIRM_W8_DEPLOY=1 is not this soak"
}

$cluster = "$env:SOLANA_CLUSTER".ToLowerInvariant()
if ($cluster -eq "mainnet" -or $cluster -eq "mainnet-beta") {
    throw "REFUSE: never mainnet"
}

if (-not $env:SOLANA_ORACLE_KEYPAIR) {
    $env:SOLANA_ORACLE_KEYPAIR = Join-Path $Root "infra\oracle-keypair.json"
}
if (-not $env:SOLANA_RPC_URL -and -not $env:SOLANA_RPC_ENDPOINT) {
    $env:SOLANA_RPC_URL = "https://api.devnet.solana.com"
}
if (-not $env:PROXYHUB_GATEWAY_BOND_PROGRAM_ID) {
    $env:PROXYHUB_GATEWAY_BOND_PROGRAM_ID = "7nvrNVaNWcG4DzcPygEyXoVC3k19ePUAncGE25dUEyi5"
}

Remove-Item Env:PROXYHUB_GATEWAY_SLASH_AUTO -ErrorAction SilentlyContinue
Remove-Item Env:PROXYHUB_GATEWAY_SLASH_CONFIRM -ErrorAction SilentlyContinue

Write-Host "=== W11.C gateway-bond release soak (no slash) ==="
Push-Location $ApiDir
try {
    go run ./cmd/w8-gateway-bond soak-release
    if ($LASTEXITCODE -ne 0) { throw "soak-release failed (exit $LASTEXITCODE)" }
}
finally {
    Pop-Location
}

# Wave 8 / P0.4 — initialize_config + set_deploy_allowed + one tiny bond on devnet.
# Never accuse. Never slash. Never programs/session. Never mainnet.
#
#   $env:CONFIRM_W8_DEVNET_SOAK = "1"
#   powershell -File scripts/w8-devnet-soak-gateway-bond.ps1

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ApiDir = Join-Path $Root "services\control-api"

if ($env:CONFIRM_W8_DEVNET_SOAK -ne "1") {
    throw "REFUSE: set CONFIRM_W8_DEVNET_SOAK=1 (never accuse/slash)"
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

# Dual-gates must stay off for this observe soak.
Remove-Item Env:PROXYHUB_GATEWAY_SLASH_AUTO -ErrorAction SilentlyContinue
Remove-Item Env:PROXYHUB_GATEWAY_SLASH_CONFIRM -ErrorAction SilentlyContinue

Write-Host "=== W8 gateway-bond devnet soak (init + one bond, no slash) ==="
Push-Location $ApiDir
try {
    go run ./cmd/w8-gateway-bond soak
    if ($LASTEXITCODE -ne 0) { throw "soak failed (exit $LASTEXITCODE)" }
}
finally {
    Pop-Location
}

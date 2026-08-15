# Wave 8 / P0.4 — deploy programs/gateway-bond to Solana devnet (observe).
# Never programs/session. Never mainnet. Does not execute slash.
#
#   $env:CONFIRM_W8_DEVNET_DEPLOY = "1"
#   powershell -File scripts/w8-devnet-deploy-gateway-bond.ps1
#
# CONFIRM_W8_DEPLOY=1 is NOT this script (unit smokes refuse that flag).

param(
    [string]$Rpc = "https://api.devnet.solana.com",
    [string]$SoPath = "",
    [string]$ProgramKeypair = "",
    [string]$UpgradeAuthority = "",
    [string]$PayerKeypair = ""
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$SessionId = "8TP21JyrghboxZqXMozx2sVzrDrNSZyN2hkf1D7dQGmb"
$ExpectedId = "7nvrNVaNWcG4DzcPygEyXoVC3k19ePUAncGE25dUEyi5"
$ExpectedAuth = "6thzwmrfijDA5eukKzMAbQnL86RqdxiLx2maM94bRJcR"

if (-not $SoPath) { $SoPath = Join-Path $Root "programs\gateway-bond\target\deploy\proxy_gateway_bond.so" }
if (-not $ProgramKeypair) { $ProgramKeypair = Join-Path $Root "programs\gateway-bond\keys\proxy_gateway_bond-keypair.json" }
if (-not $UpgradeAuthority) { $UpgradeAuthority = Join-Path $Root "infra\secrets\upgrade-authority-keypair.json" }
if (-not $PayerKeypair) { $PayerKeypair = Join-Path $Root "infra\oracle-keypair.json" }

Write-Host "=== W8 gateway-bond devnet deploy (observe, no slash) ==="

if ($env:CONFIRM_W8_DEVNET_DEPLOY -ne "1") {
    throw "REFUSE: set CONFIRM_W8_DEVNET_DEPLOY=1. CONFIRM_W8_DEPLOY=1 is not a deploy tool."
}
if ($env:CONFIRM_W8_DEPLOY -eq "1") {
    throw "REFUSE: CONFIRM_W8_DEPLOY=1 is not this script. Use CONFIRM_W8_DEVNET_DEPLOY=1 only."
}

$cluster = "$env:SOLANA_CLUSTER".ToLowerInvariant()
if ($cluster -eq "mainnet" -or $cluster -eq "mainnet-beta") {
    throw "REFUSE: never mainnet"
}
if ($Rpc.ToLowerInvariant().Contains("mainnet")) {
    throw "REFUSE: never mainnet RPC ($Rpc)"
}

foreach ($p in @($SoPath, $ProgramKeypair, $UpgradeAuthority, $PayerKeypair)) {
    if (-not (Test-Path $p)) { throw "missing $p" }
}

$bytes = [System.IO.File]::ReadAllBytes($SoPath)
$utf8 = [System.Text.Encoding]::UTF8.GetString($bytes)
if ($utf8 -notmatch "gateway-bond config init deploy_allowed=false") {
    throw "FAIL: .so lacks initialize marker"
}
if ($utf8.Contains($SessionId)) {
    throw "FAIL: .so must not embed programs/session id"
}

$progPub = (solana-keygen pubkey $ProgramKeypair | Select-Object -Last 1).Trim()
if ($progPub -ne $ExpectedId) {
    throw "FAIL: program keypair pubkey $progPub != $ExpectedId"
}
$authPub = (solana-keygen pubkey $UpgradeAuthority | Select-Object -Last 1).Trim()
if ($authPub -ne $ExpectedAuth) {
    throw "FAIL: upgrade authority $authPub != $ExpectedAuth"
}

$sha = (Get-FileHash $SoPath -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host "program_id=$progPub"
Write-Host "upgrade_authority_pubkey=$authPub"
Write-Host "so_size=$((Get-Item $SoPath).Length) sha256=$sha"
Write-Host "rpc=$Rpc"

solana program deploy `
    --url $Rpc `
    --keypair $PayerKeypair `
    --program-id $ProgramKeypair `
    --upgrade-authority $UpgradeAuthority `
    $SoPath
if ($LASTEXITCODE -ne 0) { throw "solana program deploy failed (exit $LASTEXITCODE)" }

solana program show $ExpectedId --url $Rpc
if ($LASTEXITCODE -ne 0) { throw "solana program show failed" }

Write-Host "W8_DEVNET_DEPLOY_OK"
Write-Host "live_economic_slash remains false; do not set PROXYHUB_GATEWAY_SLASH_* on GCP"

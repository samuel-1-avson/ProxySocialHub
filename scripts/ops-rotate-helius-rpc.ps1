# Rotate the keyed Helius devnet RPC URL in Secret Manager + Host-A .env.
# Does not copy upgrade authority to GCP. Does not print the API key.
#
#   $env:NEW_HELIUS_RPC_URL = 'https://devnet.helius-rpc.com/?api-key=...'
#   $env:CONFIRM_HELIUS_ROTATE = '1'
#   powershell -File scripts/ops-rotate-helius-rpc.ps1
#
# Mint the replacement key in the Helius dashboard first. This script cannot
# create Helius keys.

param(
    [string]$Project = "gen-lang-client-0022105784",
    [string]$SecretName = "proxyhubb-testnet-solana-rpc-url",
    [string]$Instance = "proxyhubb-testnet",
    [string]$Zone = "us-central1-a",
    [string]$ExpectedAuth = "6thzwmrfijDA5eukKzMAbQnL86RqdxiLx2maM94bRJcR"
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$UpgradeKp = Join-Path $Root "infra\secrets\upgrade-authority-keypair.json"

function Mask-Text([string]$s) {
    if ([string]::IsNullOrEmpty($s)) { return $s }
    return ($s -replace 'api[-_]?key=([^&\s"'']+)', 'api-key=***')
}

Write-Host "=== rotate Helius keyed RPC (no upgrade-authority copy) ==="

if ($env:CONFIRM_HELIUS_ROTATE -ne "1") {
    throw "REFUSE: set CONFIRM_HELIUS_ROTATE=1 after minting a new Helius key"
}
$url = [string]$env:NEW_HELIUS_RPC_URL
if ([string]::IsNullOrWhiteSpace($url)) {
    throw "REFUSE: NEW_HELIUS_RPC_URL is required (Helius dashboard mint; this script cannot create keys)"
}
$url = $url.Trim()
if ($url -notmatch '^https://devnet\.helius-rpc\.com/\?api-key=.+') {
    throw "REFUSE: expected https://devnet.helius-rpc.com/?api-key=... (masked in logs)"
}
if ($url.ToLower().Contains("mainnet")) {
    throw "REFUSE: never mainnet"
}
if (-not (Test-Path $UpgradeKp)) {
    throw "missing laptop upgrade authority $UpgradeKp"
}
$auth = (solana-keygen pubkey $UpgradeKp | Select-Object -Last 1).Trim()
if ($auth -ne $ExpectedAuth) {
    throw "FAIL: upgrade authority $auth != $ExpectedAuth"
}
Write-Host "upgrade_authority_stays_on_laptop=$auth"

$body = '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
try {
    $health = Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json" -Body $body -TimeoutSec 20
    Write-Host ("probe_health=" + $health.result)
} catch {
    throw ("PROBE_FAIL " + (Mask-Text $_.Exception.Message))
}

$tmp = Join-Path $env:TEMP ("helius-rpc-" + [guid]::NewGuid().ToString("N") + ".txt")
try {
    [IO.File]::WriteAllText($tmp, $url)
    gcloud secrets versions add $SecretName --project=$Project --data-file=$tmp
    if ($LASTEXITCODE -ne 0) { throw "gcloud secrets versions add failed" }
} finally {
    if (Test-Path $tmp) { Remove-Item -Force $tmp }
}

Write-Host "secret_added=$SecretName (payload not printed)"
Write-Host "Next: scp patched ops-apply-keyed-rpc.sh; SKIP_SETTLE=1 SECRET=$SecretName on Host-A (w6+w10 overlays)."
Write-Host "Then disable the old Helius key in the dashboard."
Write-Host "HELIUS_ROTATE_SM_OK"

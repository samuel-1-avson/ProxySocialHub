# Interactive manual devnet session - wallet browser steps + provider CLI prep.
# Does not replace Phantom (deposits) or long-running provider-node.
#
# Usage:
#   .\scripts\manual-devnet-session.ps1
#   .\scripts\manual-devnet-session.ps1 -ApiBaseUrl https://staging-api.example.com

param(
    [string]$ApiBaseUrl = "http://localhost:18080",
    [string]$WebBaseUrl = "http://localhost:3000",
    [switch]$OpenBrowser
)

$ErrorActionPreference = "Continue"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Load-DotEnv([string]$path) {
    if (-not (Test-Path $path)) { return }
    Get-Content $path | ForEach-Object {
        if ($_ -match '^\s*([^#=]+)=(.*)$') {
            $k = $matches[1].Trim()
            $v = $matches[2].Trim().Trim('"').Trim("'")
            Set-Item -Path "env:$k" -Value $v
        }
    }
}

Load-DotEnv (Join-Path $repoRoot ".env")
$base = $ApiBaseUrl.TrimEnd('/')
$cliDownloadUrl = "$base/v1/cli/download?platform=windows&arch=amd64"

Write-Host ""
Write-Host "=== Manual devnet session ===" -ForegroundColor Cyan
Write-Host "Full checklist: docs/MANUAL_DEVNET_SESSION.md"
Write-Host ""

Write-Host "--- Preflight ---" -ForegroundColor Yellow
try {
    $h = Invoke-RestMethod "$base/health" -TimeoutSec 10
    if ($h.status -eq "ok") { Write-Host "[OK] API health" -ForegroundColor Green }
    else { Write-Host "[WARN] API health unexpected" -ForegroundColor Yellow }
}
catch {
    Write-Host "[FAIL] API not reachable at $base - start: docker compose -f docker-compose.dev.yml up -d" -ForegroundColor Red
    exit 1
}

try {
    $sol = Invoke-RestMethod "$base/v1/solana/health" -TimeoutSec 15
    Write-Host "[OK] Solana network=$($sol.network) oracle=$($sol.oracle) balance=$($sol.balance_sol) SOL" -ForegroundColor Green
    if ($sol.balance_sol -lt 0.5) {
        Write-Host "[WARN] Oracle balance low - fund infra/oracle-keypair.json on devnet" -ForegroundColor Yellow
    }
}
catch {
    Write-Host "[WARN] /v1/solana/health failed: $($_.Exception.Message)" -ForegroundColor Yellow
}

$treasuryAddr = "(see GET /v1/treasury/public)"
try {
    $t = Invoke-RestMethod "$base/v1/treasury/public" -TimeoutSec 30
    Write-Host "[OK] Treasury $($t.treasury.address) $($t.treasury.combined_balance_sol) SOL status=$($t.treasury.status)" -ForegroundColor Green
    $treasuryAddr = $t.treasury.address
}
catch {
    Write-Host "[WARN] treasury/public failed" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "--- Provider DB hints (docker postgres) ---" -ForegroundColor Yellow
$pgUser = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { "proxyhubb" }
$pgDb = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { "proxyhubb" }

function Invoke-Psql([string]$sql) {
    $out = docker exec proxyhubb-postgres psql -U $pgUser -d $pgDb -tAc $sql 2>$null
    if ($LASTEXITCODE -ne 0) { return "" }
    return ($out | Out-String).Trim()
}

$profileId = Invoke-Psql "SELECT id FROM profiles WHERE role = 'provider' ORDER BY created_at DESC LIMIT 1;"
if (-not $profileId) {
    $profileId = Invoke-Psql "SELECT id FROM profiles ORDER BY created_at DESC LIMIT 1;"
}
$nodeId = ""
if ($profileId) {
    Write-Host "Latest provider profile: $profileId"
    Write-Host "Expected gateway_node_id after link: node_$profileId"
    $nodeId = Invoke-Psql "SELECT id FROM provider_nodes WHERE user_id = '$profileId' ORDER BY created_at DESC LIMIT 1;"
    if ($nodeId) {
        Write-Host "provider_nodes.id for provider.toml node_id: $nodeId"
        $pn = Invoke-Psql "SELECT status, gateway_node_id, last_seen_at::text FROM provider_nodes WHERE id = '$nodeId';"
        Write-Host "  row: $pn"
    }
    else {
        Write-Host "No provider_nodes yet - register at $WebBaseUrl/dashboard/provider/setup"
    }
}
else {
    Write-Host "No profiles in DB - sign up via web first"
}

Write-Host ""
Write-Host "--- Provider CLI config (no dashboard token copy) ---" -ForegroundColor Yellow
$bootstrap = Join-Path $PSScriptRoot "bootstrap-provider-dev.ps1"
if (Test-Path $bootstrap) {
    $bootArgs = @{ ApiBaseUrl = $base }
    if ($profileId) { $bootArgs["ProfileId"] = $profileId }
    & $bootstrap @bootArgs -TokenOnly -SkipAuthTest
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[WARN] bootstrap-provider-dev failed — fix .env / postgres / TOKEN_HMAC_SECRET" -ForegroundColor Yellow
    }
} else {
    Write-Host "[WARN] Missing $bootstrap" -ForegroundColor Yellow
}
. (Join-Path $PSScriptRoot "provider-paths.ps1")
$tomlPath = Resolve-ProviderConfigPath

Write-Host ""
Write-Host "--- Part A: Wallet (browser) ---" -ForegroundColor Cyan
Write-Host "  [A1] Log in - $WebBaseUrl/login"
Write-Host "  [A2] Link Phantom devnet - $WebBaseUrl/dashboard/wallet"
Write-Host "  [A3] Deposit SOL to treasury $treasuryAddr"
Write-Host "  [A4] Withdraw 0.5 SOL (small)"
Write-Host "  [A5] Withdraw over 10 SOL with signature"
Write-Host "  [A6] Set withdrawal whitelist"
Write-Host "  [A7] Treasury page - $WebBaseUrl/treasury"

Write-Host ""
Write-Host "--- Part B: Provider CLI ---" -ForegroundColor Cyan
Write-Host "  [B1] $WebBaseUrl/dashboard/provider/setup - API token and register node"
Write-Host "  [B2] Edit $tomlPath - set api_key and confirm node_id"
Write-Host "  [B3] Download CLI:"
Write-Host ('       curl.exe -o $env:TEMP\provider-node.exe "' + $cliDownloadUrl + '"')
Write-Host ('  [B4] Run: provider-node start --config "' + $tomlPath + '" (2-3 min)')
if ($profileId -and $nodeId) {
    Write-Host "  [B5] Verify:"
    Write-Host "       .\scripts\registry-e2e-check.ps1 -ProfileId '$profileId' -NodeId '$nodeId'"
}

Write-Host ""
Write-Host "--- Optional: synthetic auth smoke (no Phantom) ---" -ForegroundColor DarkGray
Write-Host "  cd services\control-api; go run ./cmd/smoke_wallet_api -base $base"

if ($OpenBrowser) {
    Start-Process "$WebBaseUrl/dashboard/wallet"
    Start-Process "$WebBaseUrl/dashboard/provider/setup"
}

Write-Host ""
Write-Host "When done, update checkboxes in docs/MANUAL_DEVNET_SESSION.md" -ForegroundColor Green
Write-Host "Staging: re-run with -ApiBaseUrl https://your-staging-api" -ForegroundColor DarkGray

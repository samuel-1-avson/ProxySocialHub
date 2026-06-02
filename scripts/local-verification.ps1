# Local pre-staging verification (no GitHub Actions).
# Chains wallet closure, public E2E, wallet API smoke, and provider phase 1 checks.
#
# Prerequisites: docker compose -f docker-compose.dev.yml up -d postgres redis nats control-api web edge-gateway
# Optional: docker compose -f docker-compose.dev.yml run --rm db-migrate
#
# Usage:
#   .\scripts\local-verification.ps1
#   .\scripts\local-verification.ps1 -SkipProviderDownload

param(
    [string]$ApiBaseUrl = "http://localhost:18080",
    [string]$WebBaseUrl = "http://localhost:3000",
    [switch]$SkipProviderDownload
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot
. (Join-Path $PSScriptRoot "_env.ps1")
Import-RepoDotEnv $repoRoot

if ($ApiBaseUrl -match 'your-staging|example\.com|\.\.\.|^https?://\.\.\.$') {
    Write-Error @"
ApiBaseUrl looks like a documentation placeholder: $ApiBaseUrl

For local Docker dev, omit -ApiBaseUrl (defaults to http://localhost:18080):
  .\scripts\local-verification.ps1

For real staging, pass your deployed API origin, e.g.:
  .\scripts\local-verification.ps1 -ApiBaseUrl https://api.staging.yourdomain.com
"@
}

$failed = $false

function Step([string]$name, [scriptblock]$block) {
    Write-Host ""
    Write-Host "========== $name ==========" -ForegroundColor Cyan
    try {
        $LASTEXITCODE = 0
        & $block
        $stepExit = $LASTEXITCODE
        if ($stepExit -ne 0 -and $null -ne $stepExit) {
            throw "exit code $stepExit"
        }
        Write-Host "[PASS] $name" -ForegroundColor Green
    } catch {
        Write-Host "[FAIL] $name — $($_.Exception.Message)" -ForegroundColor Red
        $script:failed = $true
    }
}

Write-Host "Local verification (CI skipped)" -ForegroundColor Green
Write-Host "API: $ApiBaseUrl  Web: $WebBaseUrl"

Step "Wallet production closure" {
    & "$PSScriptRoot\wallet-production-closure.ps1" -ApiBaseUrl $ApiBaseUrl
}

Step "Wallet manual E2E (public)" {
    & "$PSScriptRoot\wallet-manual-e2e.ps1" -ApiBaseUrl $ApiBaseUrl -WebBaseUrl $WebBaseUrl
}

Step "Wallet API smoke (synthetic auth)" {
    Push-Location (Join-Path $repoRoot "services\control-api")
    go run ./cmd/smoke_wallet_api -base $ApiBaseUrl
    Pop-Location
}

Step "Provider phase 1 verify" {
    if ($SkipProviderDownload) {
        & "$PSScriptRoot\verify-provider-phase1.ps1" -SkipDownload
    } else {
        & "$PSScriptRoot\verify-provider-phase1.ps1"
    }
}

Write-Host ""
if ($failed) {
    Write-Host "One or more steps failed." -ForegroundColor Red
    exit 1
}

Write-Host "Automated local verification passed." -ForegroundColor Green
Write-Host ""
Write-Host "Manual only (browser + devnet wallet):" -ForegroundColor Yellow
Write-Host "  - docs/WALLET_E2E_SMOKE.md (deposit, real withdraw)"
Write-Host "  - docs/DEV_SOLANA_SMOKE.md (oracle funded)"
Write-Host "  - docs/PROVIDER_PHASE1_VERIFY.md sections B–D (CLI running 2–3 min)"
Write-Host "  - Tick staging rows in docs/WALLET_PRODUCTION_CLOSURE.md section 6 when targeting prod/staging"
exit 0

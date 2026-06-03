# Phase 3 immediate gate - API + optional Playwright smoke (no devnet wallet).
# Usage:
#   .\scripts\verify-phase3-gate.ps1
#   .\scripts\verify-phase3-gate.ps1 -RunUiSmoke

param(
    [string]$ApiBase = "http://localhost:18080",
    [string]$WebBase = "http://localhost:3009",
    [switch]$RunUiSmoke
)

$ErrorActionPreference = "Stop"

function Test-JsonGet {
    param([string]$Url, [string]$Label)
    try {
        $r = Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 15
        Write-Host "[OK] $Label" -ForegroundColor Green
        return $r
    }
    catch {
        Write-Host "[FAIL] $Label - $_" -ForegroundColor Red
        throw
    }
}

Write-Host "=== Phase 3 gate: API smoke ($ApiBase) ===" -ForegroundColor Cyan
$ready = Test-JsonGet "$ApiBase/v1/governance/execution-readiness" "execution-readiness"
$ready | ConvertTo-Json -Depth 4 | Write-Host

$beta = Test-JsonGet "$ApiBase/v1/beta-program" "beta-program catalog"
Write-Host "  tasks: $($beta.tasks.Count), potential_usdc: $($beta.stats.potential_usdc)"

if ($RunUiSmoke) {
    Write-Host ""
    Write-Host "=== Phase 3 gate: UI smoke ($WebBase) ===" -ForegroundColor Cyan
    Push-Location (Join-Path $PSScriptRoot "..\apps\web")
    $env:TEST_BASE_URL = $WebBase
    $env:TEST_API_URL = $ApiBase
    npm run test:e2e:governance:smoke
    if ($LASTEXITCODE -ne 0) {
        Pop-Location
        exit $LASTEXITCODE
    }
    Pop-Location
}

Write-Host ""
Write-Host "P0 devnet E2E (requires funded devnet wallet + TEST_BUYER_JWT linked to same pubkey):" -ForegroundColor Yellow
Write-Host "  cd apps/web"
Write-Host "  npm run test:e2e:governance:devnet:check"
Write-Host "  npm run test:e2e:governance:devnet"

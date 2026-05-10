param(
    [switch]$RunSettlementIntegration,
    [string]$ArtifactDir = "testing/artifacts",
    [string]$TestApiUrl = "http://localhost:18080",
    [string]$TestBaseUrl,
    [string]$WebProject = "chromium"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$gateRelativeDir = Join-Path $ArtifactDir "release-gate-$timestamp"
$gateRoot = Join-Path $repoRoot $gateRelativeDir

New-Item -ItemType Directory -Force -Path $gateRoot | Out-Null

function Get-RepoRelativePath {
    param([string]$Path)

    return ([System.IO.Path]::GetRelativePath($repoRoot, $Path) -replace "\\", "/")
}

$summaryPath = Join-Path $gateRoot "gate-summary.json"
$summary = [ordered]@{
    started_at = (Get-Date).ToString("o")
    release_command = ".\\scripts\\validate-release-gate-rc.ps1" + $(if ($RunSettlementIntegration) { " -RunSettlementIntegration" } else { "" })
    contract_reference = "docs/openapi.yaml"
    authority_reference = "docs/runbooks/public-testnet-authority-matrix.md"
    slices = [ordered]@{}
}

$failedSlices = New-Object 'System.Collections.Generic.List[string]'

function Save-Summary {
    $summary.updated_at = (Get-Date).ToString("o")
    $summary | ConvertTo-Json -Depth 8 | Set-Content -Path $summaryPath -Encoding utf8
}

function Restore-EnvVar {
    param(
        [string]$Name,
        [AllowNull()]$PreviousValue
    )

    if ($null -ne $PreviousValue) {
        Set-Item -Path "Env:$Name" -Value $PreviousValue
        return
    }

    if (Test-Path "Env:$Name") {
        Remove-Item "Env:$Name" -ErrorAction SilentlyContinue
    }
}

function Invoke-GateSlice {
    param(
        [string]$Name,
        [scriptblock]$Action
    )

    $sliceEntry = [ordered]@{
        status = "running"
        started_at = (Get-Date).ToString("o")
    }
    $summary.slices[$Name] = $sliceEntry
    Save-Summary

    try {
        & $Action $sliceEntry
        $sliceEntry.status = "passed"
    }
    catch {
        $sliceEntry.status = "failed"
        $sliceEntry.error = $_.Exception.Message
        $failedSlices.Add($Name) | Out-Null
    }
    finally {
        $sliceEntry.finished_at = (Get-Date).ToString("o")
        Save-Summary
    }
}

Invoke-GateSlice "backend" {
    param($sliceEntry)

    $sliceRelativeDir = Join-Path $gateRelativeDir "backend"
    $sliceRoot = Join-Path $repoRoot $sliceRelativeDir
    New-Item -ItemType Directory -Force -Path $sliceRoot | Out-Null

    $logPath = Join-Path $sliceRoot "settlement.log"
    $sliceEntry.command = ".\\scripts\\validate-settlement-rc.ps1" + $(if ($RunSettlementIntegration) { " -RunIntegration" } else { "" })
    $sliceEntry.log = Get-RepoRelativePath $logPath

    Write-Host "Running RC-03 settlement validation slice..."

    $settlementParams = @{
        ArtifactDir = $sliceRelativeDir
    }
    if ($RunSettlementIntegration) {
        $settlementParams.RunIntegration = $true
    }

    & (Join-Path $repoRoot "scripts/validate-settlement-rc.ps1") @settlementParams 2>&1 |
        Tee-Object -FilePath $logPath | Out-Null

    $sliceEntry.artifacts = Get-ChildItem -Path $sliceRoot -File |
        Sort-Object Name |
        ForEach-Object { Get-RepoRelativePath $_.FullName }
}

Invoke-GateSlice "web" {
    param($sliceEntry)

    $sliceRoot = Join-Path $gateRoot "web"
    New-Item -ItemType Directory -Force -Path $sliceRoot | Out-Null

    $logPath = Join-Path $sliceRoot "auth-e2e.log"
    $sliceEntry.command = "npx playwright test e2e/auth.spec.ts --project=$WebProject"
    $sliceEntry.log = Get-RepoRelativePath $logPath

    $previousTestApiUrl = if (Test-Path Env:TEST_API_URL) { $env:TEST_API_URL } else { $null }
    $previousTestBaseUrl = if (Test-Path Env:TEST_BASE_URL) { $env:TEST_BASE_URL } else { $null }
    $previousPlaywrightHtmlOpen = if (Test-Path Env:PLAYWRIGHT_HTML_OPEN) { $env:PLAYWRIGHT_HTML_OPEN } else { $null }

    try {
        Write-Host "Running RC-09 web auth E2E slice..."

        Set-Item -Path Env:TEST_API_URL -Value $TestApiUrl
        Set-Item -Path Env:PLAYWRIGHT_HTML_OPEN -Value "never"
        if ([string]::IsNullOrWhiteSpace($TestBaseUrl)) {
            if (Test-Path Env:TEST_BASE_URL) {
                Remove-Item Env:TEST_BASE_URL -ErrorAction SilentlyContinue
            }
        }
        else {
            Set-Item -Path Env:TEST_BASE_URL -Value $TestBaseUrl
        }

        Push-Location (Join-Path $repoRoot "apps/web")
        try {
            Remove-Item "playwright-report" -Recurse -Force -ErrorAction SilentlyContinue
            Remove-Item "test-results" -Recurse -Force -ErrorAction SilentlyContinue

            & npx playwright test e2e/auth.spec.ts --project=$WebProject 2>&1 |
                Tee-Object -FilePath $logPath | Out-Null
            if ($LASTEXITCODE -ne 0) {
                throw "Web auth E2E validation failed."
            }
        }
        finally {
            Pop-Location
        }
    }
    finally {
        Restore-EnvVar -Name "TEST_API_URL" -PreviousValue $previousTestApiUrl
        Restore-EnvVar -Name "TEST_BASE_URL" -PreviousValue $previousTestBaseUrl
        Restore-EnvVar -Name "PLAYWRIGHT_HTML_OPEN" -PreviousValue $previousPlaywrightHtmlOpen
    }

    $sourceReportDir = Join-Path $repoRoot "apps/web/playwright-report"
    if (Test-Path $sourceReportDir) {
        $destReportDir = Join-Path $sliceRoot "playwright-report"
        Copy-Item -Path $sourceReportDir -Destination $destReportDir -Recurse -Force
        $sliceEntry.report_dir = Get-RepoRelativePath $destReportDir
    }

    $sourceResultsDir = Join-Path $repoRoot "apps/web/test-results"
    if (Test-Path $sourceResultsDir) {
        $destResultsDir = Join-Path $sliceRoot "test-results"
        Copy-Item -Path $sourceResultsDir -Destination $destResultsDir -Recurse -Force
        $sliceEntry.results_dir = Get-RepoRelativePath $destResultsDir
    }
}

Invoke-GateSlice "anchor" {
    param($sliceEntry)

    $sliceRoot = Join-Path $gateRoot "anchor"
    New-Item -ItemType Directory -Force -Path $sliceRoot | Out-Null

    $logPath = Join-Path $sliceRoot "anchor.log"
    $sliceEntry.command = "anchor test"
    $sliceEntry.log = Get-RepoRelativePath $logPath

    Write-Host "Running RC-09 Anchor validation slice..."

    Push-Location (Join-Path $repoRoot "services/solana-programs/proxyhub")
    try {
        & anchor test 2>&1 | Tee-Object -FilePath $logPath | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Anchor validation failed."
        }
    }
    finally {
        Pop-Location
    }
}

if ($failedSlices.Count -gt 0) {
    $summary.status = "failed"
    $summary.promotion_blocked = $true
    $summary.failed_slices = @($failedSlices)
    Save-Summary
    throw "Release gate failed in slice(s): $($failedSlices -join ', '). See $(Get-RepoRelativePath $summaryPath)."
}

$summary.status = "passed"
$summary.promotion_blocked = $false
$summary.finished_at = (Get-Date).ToString("o")
Save-Summary

Write-Host "Release gate passed. Summary: $(Get-RepoRelativePath $summaryPath)"

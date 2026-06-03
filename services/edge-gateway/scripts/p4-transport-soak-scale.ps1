# Scale soak profiles for P4 transport load-lab (10k gate) and dev ramp ladder.
# See docs/P4_TRANSPORT_SOAK_RUNBOOK.md
param(
    [ValidateSet('dev-ladder', 'load-lab-10k', 'load-lab-24h')]
    [string]$Profile = 'dev-ladder',
    [switch]$SkipGatewayRestart,
    [switch]$SkipPreflight
)

$ErrorActionPreference = "Stop"
$ScriptDir = $PSScriptRoot
$RepoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $ScriptDir))
$SoakScript = Join-Path $ScriptDir "p4-transport-soak.ps1"

function Import-DotEnv([string]$Path) {
    if (-not (Test-Path $Path)) { return }
    Get-Content $Path | ForEach-Object {
        $line = $_.Trim()
        if ($line -eq "" -or $line.StartsWith("#")) { return }
        if ($line -match '^\s*([^#=]+)=(.*)$') {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim().Trim('"').Trim("'")
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
}

Import-DotEnv (Join-Path $RepoRoot ".env")

$gatewayPort = if ($env:EDGE_GATEWAY_PORT) { [int]$env:EDGE_GATEWAY_PORT } else { 8090 }
$metricsPort = if ($env:EDGE_GATEWAY_METRICS_PORT) { [int]$env:EDGE_GATEWAY_METRICS_PORT } else { 9092 }
$maxConn = if ($env:MAX_CONCURRENT_CONNECTIONS) { [int]$env:MAX_CONCURRENT_CONNECTIONS } else { 8192 }

Write-Host "== P4 scale soak profile: $Profile ==" -ForegroundColor Cyan
Write-Host "Host: $env:COMPUTERNAME | buyer :$gatewayPort | metrics :$metricsPort | MAX_CONCURRENT_CONNECTIONS=$maxConn"

if ($Profile -ne 'dev-ladder') {
    if ($env:OS -match 'Windows') {
        Write-Warning "Load-lab profiles target Linux ops hardware. Windows runs are best-effort only."
    }
    if ($maxConn -lt 10000) {
        throw "MAX_CONCURRENT_CONNECTIONS=$maxConn is below 10000. Set MAX_CONCURRENT_CONNECTIONS>=12288 in .env and recreate edge-gateway before load-lab-10k."
    }
}

if (-not $SkipGatewayRestart) {
    Write-Host "Restarting edge-gateway for clean connection baseline..."
    Push-Location $RepoRoot
    try {
        docker compose -f docker-compose.yml -f docker-compose.provider.yml restart edge-gateway | Out-Null
        docker restart proxyhubb-provider-node 2>$null | Out-Null
        Start-Sleep -Seconds 25
    } finally {
        Pop-Location
    }
}

if (-not $SkipPreflight) {
    $health = "http://127.0.0.1:${gatewayPort}/health"
    Invoke-WebRequest -Uri $health -UseBasicParsing -TimeoutSec 15 | Out-Null
    $m = (Invoke-WebRequest -Uri "http://127.0.0.1:${metricsPort}/metrics" -UseBasicParsing -TimeoutSec 15).Content
    if ($m -notmatch "edge_gateway_healthy_providers\s+([1-9])") {
        throw "healthy_providers=0. Run: docker compose -f docker-compose.yml -f docker-compose.provider.yml --profile provider up -d"
    }
    Write-Host "OK preflight: /health 200, healthy_providers>=1"
}

function Invoke-SoakStep([int]$Concurrent, [int]$DurationSec, [int]$RampBatch = 50, [switch]$AllowSlowHealth) {
    Write-Host ""
    Write-Host "--- soak step: concurrent=$Concurrent duration=${DurationSec}s ---" -ForegroundColor Yellow
    $env:SOAK_CONCURRENT = "$Concurrent"
    $env:SOAK_DURATION_SEC = "$DurationSec"
    & $SoakScript -GatewayPort $gatewayPort -MetricsPort $metricsPort -TargetConcurrent $Concurrent -DurationSec $DurationSec -RampBatch $RampBatch
    $code = $LASTEXITCODE
    if ($code -eq 2 -and $AllowSlowHealth) {
        Write-Host "WARN: /health slow after release (dev saturation) - restarting gateway before next step" -ForegroundColor Yellow
        Push-Location $RepoRoot
        try {
            docker compose -f docker-compose.yml -f docker-compose.provider.yml restart edge-gateway | Out-Null
            docker restart proxyhubb-provider-node 2>$null | Out-Null
            Start-Sleep -Seconds 25
        } finally {
            Pop-Location
        }
        return
    }
    if ($code -ne 0) { throw "Soak step failed (exit $code)" }
}

switch ($Profile) {
    'dev-ladder' {
        # Laptop-safe ramp (runbook: 50+ can saturate /health on dev). Load-lab gate is load-lab-10k on Linux.
        Invoke-SoakStep -Concurrent 20 -DurationSec 45 -RampBatch 5 -AllowSlowHealth
        Invoke-SoakStep -Concurrent 30 -DurationSec 45 -RampBatch 5 -AllowSlowHealth
        Invoke-SoakStep -Concurrent 50 -DurationSec 45 -RampBatch 10 -AllowSlowHealth
        Write-Host ""
        Write-Host "Dev ladder complete. Book Linux ops host and run: .\scripts\p4-transport-soak-scale.ps1 -Profile load-lab-10k" -ForegroundColor Green
    }
    'load-lab-10k' {
        Invoke-SoakStep -Concurrent 10000 -DurationSec 600 -RampBatch 100
        $heldPct = 95
        Write-Host "Load-lab 10k complete. Verify held >= ${heldPct}% in docs/P4_TRANSPORT_SOAK.md snapshot." -ForegroundColor Green
    }
    'load-lab-24h' {
        Invoke-SoakStep -Concurrent 3000 -DurationSec 86400 -RampBatch 100
        Write-Host "Load-lab 24h complete. Verify held >= 95% and /health after release." -ForegroundColor Green
    }
}

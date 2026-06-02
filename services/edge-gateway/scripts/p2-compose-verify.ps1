# P2 full integration verify: stack up + resilience smoke + admission soak + chaos loop.
param(
    [switch]$SkipBuild,
    [int]$ChaosIterations = $(if ($env:CHAOS_ITERATIONS) { [int]$env:CHAOS_ITERATIONS } else { 3 })
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$ComposeFile = if ($env:COMPOSE_FILE) { $env:COMPOSE_FILE } else { Join-Path $Root "docker-compose.resilience.yml" }

Set-Location $Root

Write-Host "== docker compose up (resilience) =="
$upArgs = @("compose", "-f", $ComposeFile, "up", "-d")
if (-not $SkipBuild) { $upArgs += "--build" }
docker @upArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$BaseUrl = if ($env:BASE_URL) { $env:BASE_URL } else { "http://127.0.0.1:18090" }
$WaitSecs = if ($env:WAIT_SECS) { [int]$env:WAIT_SECS } else { 120 }
Write-Host "== waiting for $BaseUrl/health (max ${WaitSecs}s) =="
$deadline = (Get-Date).AddSeconds($WaitSecs)
$ok = $false
while ((Get-Date) -lt $deadline) {
    try {
        Invoke-WebRequest -Uri "$BaseUrl/health" -UseBasicParsing -TimeoutSec 5 | Out-Null
        $ok = $true
        break
    } catch { Start-Sleep -Seconds 2 }
}
if (-not $ok) {
    docker compose -f $ComposeFile logs edge-gateway --tail 40
    throw "gateway not healthy"
}

& (Join-Path $PSScriptRoot "p2-exit-verify.ps1")
& (Join-Path $PSScriptRoot "p2-resilience-smoke.ps1")
& (Join-Path $PSScriptRoot "p2-admission-soak.ps1")
$env:CHAOS_ITERATIONS = "$ChaosIterations"
& (Join-Path $PSScriptRoot "p2-chaos-loop.ps1")

Write-Host ""
Write-Host "P2 compose verification complete."
Write-Host "Teardown: docker compose -f $ComposeFile down"

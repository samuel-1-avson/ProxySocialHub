# Bring up minimal edge+redis stack, wait for health, run P1 load smoke.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$ComposeFile = if ($env:COMPOSE_FILE) { $env:COMPOSE_FILE } else { Join-Path $Root "docker-compose.resilience.yml" }
$BaseUrl = if ($env:BASE_URL) { $env:BASE_URL } else { "http://127.0.0.1:18090" }
$WaitSecs = if ($env:WAIT_SECS) { [int]$env:WAIT_SECS } else { 120 }

Set-Location $Root

Write-Host "== docker compose up (resilience test stack) =="
docker compose -f $ComposeFile up -d --build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "== waiting for $BaseUrl/health (max ${WaitSecs}s) =="
$deadline = (Get-Date).AddSeconds($WaitSecs)
$ok = $false
while ((Get-Date) -lt $deadline) {
    try {
        Invoke-WebRequest -Uri "$BaseUrl/health" -UseBasicParsing -TimeoutSec 5 | Out-Null
        $ok = $true
        break
    } catch {
        Start-Sleep -Seconds 2
    }
}
if (-not $ok) {
    docker compose -f $ComposeFile logs edge-gateway --tail 40
    throw "gateway not healthy after ${WaitSecs}s"
}
Write-Host "health OK"

$env:BASE_URL = $BaseUrl
& (Join-Path $PSScriptRoot "p1-load-smoke.ps1")

Write-Host ""
Write-Host "P1 compose smoke complete."
Write-Host "Teardown: docker compose -f $ComposeFile down"

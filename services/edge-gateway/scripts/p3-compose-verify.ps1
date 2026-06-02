# P3 full integration: multipod stack + smoke + scale benchmark + pod drain.
param(
    [switch]$SkipBuild,
    [switch]$RemoveLegacy
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\p3-compose.ps1"
Set-Location (Split-Path -Parent $PSScriptRoot)

if ($RemoveLegacy) {
    Remove-LegacyP3Containers
}

$upArgs = @("up", "-d")
if (-not $SkipBuild) { $upArgs += "--build" }
Write-Host "== docker compose -p $script:P3ComposeProject up =="
Invoke-P3Compose @upArgs

$deadline = (Get-Date).AddSeconds(120)
$ok = $false
while ((Get-Date) -lt $deadline) {
    try {
        Invoke-WebRequest -Uri "http://127.0.0.1:28090/health" -UseBasicParsing -TimeoutSec 5 | Out-Null
        Invoke-WebRequest -Uri "http://127.0.0.1:28091/health" -UseBasicParsing -TimeoutSec 5 | Out-Null
        $ok = $true
        break
    } catch { Start-Sleep -Seconds 2 }
}
if (-not $ok) { throw "P3 stack not healthy on 28090/28091" }

& (Join-Path $PSScriptRoot "p3-exit-verify.ps1")
& (Join-Path $PSScriptRoot "p3-multipod-smoke.ps1")
& (Join-Path $PSScriptRoot "p3-scale-benchmark.ps1")
& (Join-Path $PSScriptRoot "p3-pod-drain.ps1")

Write-Host ""
Write-Host "P3 compose verification complete."

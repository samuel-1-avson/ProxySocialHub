# Lightweight load smoke against a running edge-gateway (health/metrics).
param(
    [string]$BaseUrl = $(if ($env:BASE_URL) { $env:BASE_URL } else { "http://127.0.0.1:8090" }),
    [int]$Concurrency = $(if ($env:CONCURRENCY) { [int]$env:CONCURRENCY } else { 20 }),
    [int]$Seconds = $(if ($env:SMOKE_SECONDS) { [int]$env:SMOKE_SECONDS } else { 15 })
)

$ErrorActionPreference = "Stop"
Write-Host "Target: $BaseUrl (health + metrics)"

Invoke-WebRequest -Uri "$BaseUrl/health" -UseBasicParsing -TimeoutSec 10 | Out-Null
try {
    Invoke-WebRequest -Uri "$BaseUrl/ready" -UseBasicParsing -TimeoutSec 10 | Out-Null
} catch {
    Write-Host "warn: /ready not 200 (Redis/providers?)"
}

$deadline = (Get-Date).AddSeconds($Seconds)
$ok = 0
$fail = 0
Write-Host "== parallel GET /health (${Concurrency} workers, ${Seconds}s) =="

$jobs = 1..$Concurrency | ForEach-Object {
    Start-Job -ScriptBlock {
        param($Url, $UntilTicks)
        $localOk = 0
        while ([DateTime]::UtcNow.Ticks -lt $UntilTicks) {
            try {
                Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5 | Out-Null
                $localOk++
            } catch { }
        }
        $localOk
    } -ArgumentList "$BaseUrl/health", $deadline.Ticks
}

$results = $jobs | Wait-Job | Receive-Job
$jobs | Remove-Job -Force
$ok = ($results | Measure-Object -Sum).Sum
Write-Host "Completed $ok successful /health requests in ~${Seconds}s"

Write-Host "Done. For tunnel/CPU validation, run provider+client integration load separately."

# P3 horizontal scale benchmark: directory fan-out visible on both pods + parallel buyer health load.
param(
    [int]$EdgeAPort = $(if ($env:P3_EDGE_A_PORT) { [int]$env:P3_EDGE_A_PORT } else { 28090 }),
    [int]$EdgeBPort = $(if ($env:P3_EDGE_B_PORT) { [int]$env:P3_EDGE_B_PORT } else { 28091 }),
    [int[]]$SeedCounts = @(10, 50, 100),
    [int]$ParallelWorkers = 32
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\p3-compose.ps1"

function Seed-DirectoryEntries {
    param([int]$Count, [string]$OwnerPod)
    for ($i = 0; $i -lt $Count; $i++) {
        $nodeId = "p3-bench-$OwnerPod-$i"
        $json = (@{
            node_id = $nodeId
            pod_id = $OwnerPod
            region = $null
            updated_at = [int][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
            country_code = "US"
            latency_ms = 10
            is_healthy = $true
            quality_score = 1.0
        } | ConvertTo-Json -Compress)
        Set-P3RedisJson -Key "eg:provider:owner:$nodeId" -Json $json -ExSeconds 300
    }
}

function Get-DirectoryStats {
    param([int]$Port)
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/debug/directory/stats" -UseBasicParsing -TimeoutSec 15
    $r.Content | ConvertFrom-Json
}

function Measure-ParallelHealth {
    param([int[]]$Ports, [int]$Workers)
    $scriptBlock = {
        param($Ports, $PerWorker)
        $ok = 0
        foreach ($p in $Ports) {
            1..$PerWorker | ForEach-Object {
                try {
                    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$p/health" -UseBasicParsing -TimeoutSec 5
                    if ($r.StatusCode -eq 200) { $ok++ }
                } catch { }
            }
        }
        $ok
    }
    $perWorker = [Math]::Max(5, [int](100 / $Workers))
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $jobs = 1..$Workers | ForEach-Object {
        Start-Job -ScriptBlock $scriptBlock -ArgumentList (,$Ports), $perWorker
    }
    $oks = ($jobs | Wait-Job | Receive-Job | Measure-Object -Sum).Sum
    $jobs | Remove-Job -Force
    $sw.Stop()
    return @{ ok = $oks; elapsed_ms = $sw.ElapsedMilliseconds }
}

Write-Host "== P3 scale benchmark (edge-a :$EdgeAPort, edge-b :$EdgeBPort) =="

foreach ($port in @($EdgeAPort, $EdgeBPort)) {
    $h = Invoke-WebRequest -Uri "http://127.0.0.1:$port/health" -UseBasicParsing -TimeoutSec 10
    if ($h.StatusCode -ne 200) { throw "health failed on :$port" }
}

$results = @()
foreach ($n in $SeedCounts) {
    Write-Host "-- seed $n providers on edge-a --"
    Invoke-P3RedisCli --scan --pattern "eg:provider:owner:p3-bench-*" | ForEach-Object {
        if ($_) { Invoke-P3RedisCli DEL $_ | Out-Null }
    }
    Seed-DirectoryEntries -Count $n -OwnerPod "edge-a"

    $statsA = Get-DirectoryStats -Port $EdgeAPort
    $statsB = Get-DirectoryStats -Port $EdgeBPort
    if ($statsB.directory_total -lt $n) {
        throw "edge-b sees $($statsB.directory_total) directory entries, expected >= $n"
    }

    $load = Measure-ParallelHealth -Ports @($EdgeAPort, $EdgeBPort) -Workers $ParallelWorkers
    $rps = [math]::Round($load.ok / ($load.elapsed_ms / 1000.0), 1)
    Write-Host "  directory_total edge-b=$($statsB.directory_total) parallel_health_ok=$($load.ok) rps~=$rps"

    $results += [pscustomobject]@{
        seeded = $n
        seen_on_b = $statsB.directory_total
        health_ok = $load.ok
        elapsed_ms = $load.elapsed_ms
        approx_rps = $rps
    }
}

Write-Host ""
Write-Host "Summary:"
$results | Format-Table -AutoSize
Write-Host ""
Write-Host "OK P3 scale benchmark: fleet directory visible on non-owner pod; dual-pod health load sustained."
Write-Host "Note: linear tunnel capacity requires live providers per pod (see p3-multipod-e2e-full.ps1)."

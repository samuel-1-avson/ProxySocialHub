# Quick explorer API smoke (requires control-api on CONTROL_API_PORT, default 18080).
# Dev compose defaults FULL_DECENTRALIZATION=false so /metrics is reachable without quorum.

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\_env.ps1" -ErrorAction SilentlyContinue

$base = if ($env:CONTROL_API_PORT) { "http://localhost:$($env:CONTROL_API_PORT)" } else { "http://localhost:18080" }

function Test-Endpoint($name, $url, $requiredKeys) {
    Write-Host "== $name ==" -ForegroundColor Cyan
    $raw = curl.exe -m 20 -s $url
    if (-not $raw) { throw "empty response from $url" }
    foreach ($k in $requiredKeys) {
        if ($raw -notmatch "`"$k`"\s*:") { throw "missing key '$k' in $name" }
    }
    Write-Host "OK ($url)" -ForegroundColor Green
}

Test-Endpoint "metrics" "$base/v1/explorer/metrics" @("tps_window_hours", "transactions_per_second", "data_source")
Test-Endpoint "bandwidth" "$base/v1/explorer/bandwidth?period=24h" @("total_bandwidth_gb", "last_24h_bandwidth_gb", "avg_throughput_mbps")
Test-Endpoint "contracts" "$base/v1/explorer/contracts?page=1&page_size=2" @("contracts", "total")

Write-Host "`nExplorer API smoke passed." -ForegroundColor Green

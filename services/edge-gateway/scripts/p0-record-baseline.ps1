# Append a P0 operational metrics snapshot to docs/P0_BASELINE.md
# Usage:
#   .\scripts\p0-record-baseline.ps1
#   .\scripts\p0-record-baseline.ps1 -MetricsUrl http://127.0.0.1:9090/metrics -Note "after 5m CONNECT load"

param(
    [string]$MetricsUrl = "http://127.0.0.1:9090/metrics",
    [string]$OutFile = "docs/P0_BASELINE.md",
    [string]$Note = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Get-MetricValue([string]$text, [string]$name) {
    $m = [regex]::Match(
        $text,
        "(?m)^$([regex]::Escape($name))\s+([0-9.eE+-]+)"
    )
    if ($m.Success) { return $m.Groups[1].Value }
    return $null
}

function Get-HistogramSum([string]$text, [string]$name) {
    $sum = 0.0
    $found = $false
    foreach ($line in ($text -split "`n")) {
        if ($line -match "^$([regex]::Escape($name))_bucket\s") { continue }
        if ($line -match "^$([regex]::Escape($name))_count\s+(\S+)") {
            $found = $true
            continue
        }
        if ($line -match "^$([regex]::Escape($name))_sum\s+(\S+)") {
            $sum = [double]$Matches[1]
            break
        }
    }
    if (-not $found) { return $null }
    return $sum
}

Write-Host "Fetching $MetricsUrl"
$resp = Invoke-WebRequest -Uri $MetricsUrl -UseBasicParsing
$body = $resp.Content

$lines = @()
$lines += ""
$lines += "## Run $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')"
if ($Note) { $lines += "Note: $Note" }
$lines += ""
$lines += "Machine: $env:COMPUTERNAME"
$lines += "Metrics URL: $MetricsUrl"
$lines += ""

$snapshot = [ordered]@{
    edge_gateway_active_sessions          = Get-MetricValue $body "edge_gateway_active_sessions"
    edge_gateway_active_connections       = Get-MetricValue $body "edge_gateway_active_connections"
    edge_gateway_healthy_providers        = Get-MetricValue $body "edge_gateway_healthy_providers"
    edge_gateway_provider_active_connections = Get-MetricValue $body "edge_gateway_provider_active_connections"
    process_resident_memory_bytes         = Get-MetricValue $body "process_resident_memory_bytes"
}

$lines += "### Parsed gauges"
$lines += ""
foreach ($kv in $snapshot.GetEnumerator()) {
    $val = if ($null -eq $kv.Value) { "(missing)" } else { $kv.Value }
    $lines += "- ``$($kv.Key)`` = $val"
}
$lines += ""

$connectSum = Get-HistogramSum $body "edge_gateway_request_latency_seconds"
if ($null -ne $connectSum) {
    $lines += "- ``edge_gateway_request_latency_seconds`` cumulative sum (all methods) = $connectSum"
    $lines += ""
}

$lines += "### PromQL (Grafana / Prometheus)"
$lines += ""
$lines += '- P99 CONNECT: ``histogram_quantile(0.99, sum(rate(edge_gateway_request_latency_seconds_bucket{method="CONNECT"}[5m])) by (le))``'
$lines += '- Egress Gbps: ``sum(rate(edge_gateway_bandwidth_bytes_total{direction="egress"}[1m])) * 8 / 1e9``'
$lines += '- CPU cores used: ``rate(process_cpu_seconds_total[1m])``'
$lines += ""

$lines += "### Raw excerpt (first 80 lines)"
$lines += ""
$lines += '```'
$excerpt = ($body -split "`n" | Select-Object -First 80) -join "`n"
$lines += $excerpt.TrimEnd()
$lines += '```'
$lines += ""

$header = @"
# P0 operational baseline

Snapshots from ``scripts/p0-record-baseline.ps1``. See [`P0_BASELINE_RUNBOOK.md`](P0_BASELINE_RUNBOOK.md) for procedure and SLO targets.

"@

if (-not (Test-Path $OutFile)) {
    Set-Content -Path $OutFile -Value $header -Encoding utf8
}
Add-Content -Path $OutFile -Value ($lines -join "`n") -Encoding utf8
Write-Host "Appended snapshot to $OutFile"

# P3 pod drain: mark edge-a draining, release ownership, migrate record to edge-b.
param(
    [int]$EdgeAPort = $(if ($env:P3_EDGE_A_PORT) { [int]$env:P3_EDGE_A_PORT } else { 28090 }),
    [int]$EdgeBPort = $(if ($env:P3_EDGE_B_PORT) { [int]$env:P3_EDGE_B_PORT } else { 28091 }),
    [string]$TestNode = "p3-drain-migrate-node"
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\p3-compose.ps1"
$BaseA = "http://127.0.0.1:$EdgeAPort"
$BaseB = "http://127.0.0.1:$EdgeBPort"

Write-Host "== P3 pod drain / ownership migration =="

# Clean + seed owner edge-a
Invoke-P3RedisCli DEL "eg:provider:owner:$TestNode" | Out-Null
$json = '{"node_id":"' + $TestNode + '","pod_id":"edge-a","region":null,"updated_at":0,"country_code":"US","latency_ms":10,"is_healthy":true,"quality_score":1.0}'
Set-P3RedisJson -Key "eg:provider:owner:$TestNode" -Json $json -ExSeconds 120
Write-Host "OK seeded ownership on edge-a"

# Drain edge-a
Invoke-WebRequest -Uri "$BaseA/admin/drain" -Method POST -UseBasicParsing -TimeoutSec 10 | Out-Null
try {
    Invoke-WebRequest -Uri "$BaseA/health" -UseBasicParsing -TimeoutSec 5 | Out-Null
    throw "expected edge-a /health 503 while draining"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -ne 503) { throw "expected 503 on draining health, got $code" }
}
Write-Host "OK edge-a /health returns 503 while draining"

try {
    Invoke-WebRequest -Uri "$BaseA/ready" -UseBasicParsing -TimeoutSec 5 | Out-Null
    throw "expected edge-a /ready non-2xx while draining"
} catch {
    $resp = $_.Exception.Response
    if (-not $resp) { throw }
    $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
    $readyBody = $reader.ReadToEnd() | ConvertFrom-Json
    if ($readyBody.status -eq "ready") { throw "expected edge-a /ready not_ready while draining" }
}
Write-Host "OK edge-a /ready not_ready while draining"

# Release directory (migration prep)
$rel = Invoke-WebRequest -Uri "$BaseA/admin/drain/ownership" -Method POST -UseBasicParsing -TimeoutSec 15
$relBody = $rel.Content | ConvertFrom-Json
if ($relBody.released -lt 1) { throw "expected >=1 released keys, got $($relBody.released)" }
Write-Host "OK released $($relBody.released) ownership key(s) from edge-a"

$raw = Invoke-P3RedisCli GET "eg:provider:owner:$TestNode"
if ($raw -and $raw.Trim().Length -gt 0) {
    throw "Redis key still present after release: $raw"
}
Write-Host "OK Redis ownership cleared (provider can re-home on another pod)"

# Simulate provider reconnect on edge-b
$jsonB = '{"node_id":"' + $TestNode + '","pod_id":"edge-b","region":null,"updated_at":0,"country_code":"US","latency_ms":10,"is_healthy":true,"quality_score":1.0}'
Set-P3RedisJson -Key "eg:provider:owner:$TestNode" -Json $jsonB -ExSeconds 120
$statsB = (Invoke-WebRequest -Uri "$BaseB/debug/directory/stats" -UseBasicParsing).Content | ConvertFrom-Json
if ($statsB.directory_total -lt 1) {
    throw "edge-b should see migrated directory entry: $($statsB | ConvertTo-Json -Compress)"
}
Write-Host "OK ownership migrated to edge-b (directory visible fleet-wide)"

# edge-b still healthy
$h = Invoke-WebRequest -Uri "$BaseB/health" -UseBasicParsing -TimeoutSec 5
if ($h.StatusCode -ne 200) { throw "edge-b health failed during edge-a drain" }
Write-Host "OK edge-b remains healthy while edge-a drains"

Write-Host ""
Write-Host "P3 pod drain / migration smoke passed."

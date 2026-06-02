# P3b — split stack smoke (ingress vs tunnel tier, directory seed, routing guards).
# Prereq: .\scripts\p3-split-up.ps1 -Build
$ErrorActionPreference = "Stop"
. "$PSScriptRoot\p3-split-compose.ps1"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$EdgeAPort = if ($env:P3_SPLIT_EDGE_A_PORT) { [int]$env:P3_SPLIT_EDGE_A_PORT } else { 28100 }
$EdgeBPort = if ($env:P3_SPLIT_EDGE_B_PORT) { [int]$env:P3_SPLIT_EDGE_B_PORT } else { 28101 }
$TunnelAHttp = if ($env:P3_SPLIT_TUNNEL_A_HTTP) { [int]$env:P3_SPLIT_TUNNEL_A_HTTP } else { 28110 }
$TunnelBHttp = if ($env:P3_SPLIT_TUNNEL_B_HTTP) { [int]$env:P3_SPLIT_TUNNEL_B_HTTP } else { 28111 }

function Assert-Ok($cond, $msg) {
    if (-not $cond) { throw $msg }
}

function Probe-ConnectStatus($port) {
    $tcp = New-Object System.Net.Sockets.TcpClient("127.0.0.1", $port)
    try {
        $stream = $tcp.GetStream()
        $req = "CONNECT example.com:443 HTTP/1.1`r`nHost: example.com:443`r`n`r`n"
        $bytes = [System.Text.Encoding]::ASCII.GetBytes($req)
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush()
        Start-Sleep -Milliseconds 400
        $buf = New-Object byte[] 512
        $n = $stream.Read($buf, 0, $buf.Length)
        return [System.Text.Encoding]::ASCII.GetString($buf, 0, $n)
    } finally {
        $tcp.Close()
    }
}

Write-Host "== P3b split smoke =="

foreach ($port in @($EdgeAPort, $EdgeBPort, $TunnelAHttp, $TunnelBHttp)) {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/health" -UseBasicParsing -TimeoutSec 15
    Assert-Ok ($r.StatusCode -eq 200) "health on :$port"
    Write-Host "OK health :$port"
}

# Tunnel tier must reject public buyer CONNECT (P3b.2).
$tunnelResp = Probe-ConnectStatus $TunnelAHttp
Assert-Ok ($tunnelResp -match "403") "tunnel-a must return 403 for buyer CONNECT, got: $tunnelResp"
Write-Host "OK tunnel-a buyer CONNECT -> 403"

# Ingress still runs buyer stack (407 without session).
$ingressResp = Probe-ConnectStatus $EdgeBPort
Assert-Ok ($ingressResp -match "407") "ingress edge-b must return 407 without auth, got: $ingressResp"
Write-Host "OK edge-b buyer CONNECT without auth -> 407"

# Directory owner is tunnel-a (provider on tunnel tier, buyer via ingress).
$json = '{"node_id":"p3b-smoke-node","pod_id":"tunnel-a","region":null,"updated_at":0,"country_code":"US","latency_ms":10,"is_healthy":true,"quality_score":1.0}'
Set-P3RedisJson -Key "eg:provider:owner:p3b-smoke-node" -Json $json -ExSeconds 120
Write-Host "OK seeded directory (owner=tunnel-a)"

$stats = Invoke-WebRequest -Uri "http://127.0.0.1:${EdgeBPort}/debug/directory/stats" -UseBasicParsing -TimeoutSec 10
Assert-Ok ($stats.StatusCode -eq 200) "debug/directory/stats on ingress edge-b"
Assert-Ok ($stats.Content -match "p3b-smoke-node") "directory entry visible on ingress"
Write-Host "OK ingress sees directory entry"

Write-Host ""
Write-Host "P3b split smoke passed."
Write-Host "Full E2E (provider on tunnel-a :23228, buyer via edge-b with session) is optional; see P3b_SIGNOFF.md."

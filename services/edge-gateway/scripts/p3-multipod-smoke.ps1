# P3.3 — two-pod stack smoke (health, directory, internal forward wiring).
# Prereq: .\scripts\p3-multipod-up.ps1 -Build
$ErrorActionPreference = "Stop"
. "$PSScriptRoot\p3-compose.ps1"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$EdgeAPort = if ($env:P3_EDGE_A_PORT) { [int]$env:P3_EDGE_A_PORT } else { 28090 }
$EdgeBPort = if ($env:P3_EDGE_B_PORT) { [int]$env:P3_EDGE_B_PORT } else { 28091 }
$TunnelAPort = if ($env:P3_TUNNEL_A_PORT) { [int]$env:P3_TUNNEL_A_PORT } else { 23128 }

function Assert-Ok($cond, $msg) {
    if (-not $cond) { throw $msg }
}

Write-Host "== P3 multipod smoke (edge-a :$EdgeAPort, edge-b :$EdgeBPort) =="

foreach ($port in @($EdgeAPort, $EdgeBPort)) {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/health" -UseBasicParsing -TimeoutSec 10
    Assert-Ok ($r.StatusCode -eq 200) "health on :$port failed"
    Write-Host "OK health :$port"
}

# Inject a directory record owned by edge-a (simulates provider on pod A).
$json = '{"node_id":"p3-smoke-node","pod_id":"edge-a","region":null,"updated_at":0,"country_code":"US","latency_ms":10,"is_healthy":true,"quality_score":1.0}'
Set-P3RedisJson -Key "eg:provider:owner:p3-smoke-node" -Json $json -ExSeconds 120
Write-Host "OK seeded Redis directory entry (owner=edge-a)"

# edge-b should see the node via debug routes when enabled.
$nodes = Invoke-WebRequest -Uri "http://127.0.0.1:$EdgeBPort/debug/nodes" -UseBasicParsing -TimeoutSec 10
Assert-Ok ($nodes.StatusCode -eq 200) "debug/nodes on edge-b"
Write-Host "OK edge-b debug/nodes reachable"

# Buyer CONNECT via edge-b without local provider should fail auth (407) not 503 remote-pod.
# Full E2E requires provider-node on edge-a tunnel ($TunnelAPort) + valid session from control-api.
try {
    $tcp = New-Object System.Net.Sockets.TcpClient("127.0.0.1", $EdgeBPort)
    $stream = $tcp.GetStream()
    $req = "CONNECT example.com:443 HTTP/1.1`r`nHost: example.com:443`r`n`r`n"
    $bytes = [System.Text.Encoding]::ASCII.GetBytes($req)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
    Start-Sleep -Milliseconds 300
    $buf = New-Object byte[] 512
    $n = $stream.Read($buf, 0, $buf.Length)
    $resp = [System.Text.Encoding]::ASCII.GetString($buf, 0, $n)
    $tcp.Close()
    Assert-Ok ($resp -match "407") "expected 407 without session auth, got: $resp"
    Write-Host "OK edge-b CONNECT without auth returns 407 (routing stack alive)"
} catch {
    throw "CONNECT probe failed: $_"
}

Write-Host ""
Write-Host "P3 multipod smoke passed (infra + directory seed)."
Write-Host "For full provider-on-A / buyer-via-B E2E: provider-node -> localhost:$TunnelAPort (edge-a), buyer CONNECT -> :$EdgeBPort with a valid session."

# P2 extended chaos: repeat Redis stop/start; fail-closed CONNECT + health recovery each cycle.
param(
    [string]$GatewayHost = $(if ($env:GATEWAY_HOST) { $env:GATEWAY_HOST } else { "127.0.0.1" }),
    [int]$GatewayPort = $(if ($env:GATEWAY_PORT) { [int]$env:GATEWAY_PORT } else { 18090 }),
    [string]$ComposeFile = $(if ($env:COMPOSE_FILE) { $env:COMPOSE_FILE } else { Join-Path (Split-Path -Parent $PSScriptRoot) "docker-compose.resilience.yml" }),
    [string]$RedisService = $(if ($env:REDIS_SERVICE) { $env:REDIS_SERVICE } else { "redis" }),
    [int]$Iterations = $(if ($env:CHAOS_ITERATIONS) { [int]$env:CHAOS_ITERATIONS } else { 3 }),
    [switch]$SkipConnectProbe
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$healthUrl = "http://${GatewayHost}:${GatewayPort}/health"
try {
    Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 5 | Out-Null
} catch {
    throw "Gateway not reachable. Run: docker compose -f $ComposeFile up -d --build"
}

function Read-TcpHttpResponse {
    param([System.Net.Sockets.TcpClient]$Client, [int]$TimeoutMs = 8000)
    $stream = $Client.GetStream()
    $stream.ReadTimeout = $TimeoutMs
    $buf = New-Object byte[] 4096
    $sb = New-Object System.Text.StringBuilder
    $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            if (-not $stream.DataAvailable) {
                Start-Sleep -Milliseconds 25
                continue
            }
            $n = $stream.Read($buf, 0, $buf.Length)
            if ($n -le 0) { break }
            [void]$sb.Append([Text.Encoding]::ASCII.GetString($buf, 0, $n))
            if ($sb.ToString() -match "\r\n\r\n") { break }
        } catch [System.IO.IOException] { break }
    }
    return $sb.ToString()
}

function Test-Connect407 {
    $auth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("smoke-user:smoke-pass"))
    $req = "CONNECT example.com:443 HTTP/1.1`r`nHost: example.com:443`r`nProxy-Authorization: Basic $auth`r`n`r`n"
    $client = [System.Net.Sockets.TcpClient]::new()
    $client.Connect($GatewayHost, $GatewayPort)
    $stream = $client.GetStream()
    $bytes = [Text.Encoding]::ASCII.GetBytes($req)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
    $resp = Read-TcpHttpResponse -Client $client
    $client.Close()
    if ($resp -notmatch "407") {
        throw "expected 407 while Redis down, got: '$resp'"
    }
}

Write-Host "== P2 chaos loop ($Iterations cycles, Redis=$RedisService) =="

for ($i = 1; $i -le $Iterations; $i++) {
    Write-Host "-- cycle $i/$Iterations : stop Redis --"
    docker compose -f $ComposeFile stop $RedisService
    if ($LASTEXITCODE -ne 0) { throw "docker compose stop failed" }
    Start-Sleep -Seconds 5

    if (-not $SkipConnectProbe) {
        Test-Connect407
        Write-Host "  CONNECT 407 OK (fail-closed)"
    }

    Write-Host "-- cycle $i/$Iterations : start Redis --"
    docker compose -f $ComposeFile start $RedisService | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "docker compose start failed" }
    Start-Sleep -Seconds 4

    try {
        Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 15 | Out-Null
        Write-Host "  health OK"
    } catch {
        throw "health failed after Redis restart (cycle $i): $_"
    }
}

Write-Host "P2 chaos loop complete ($Iterations cycles)."

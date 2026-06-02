# P2 smoke: admission 503 (hold permits) + Redis down -> CONNECT 407.
param(
    [string]$GatewayHost = $(if ($env:GATEWAY_HOST) { $env:GATEWAY_HOST } else { "127.0.0.1" }),
    [int]$GatewayPort = $(if ($env:GATEWAY_PORT) { [int]$env:GATEWAY_PORT } else { 18090 }),
    [string]$ComposeFile = $(if ($env:COMPOSE_FILE) { $env:COMPOSE_FILE } else { Join-Path (Split-Path -Parent $PSScriptRoot) "docker-compose.resilience.yml" }),
    [string]$RedisService = $(if ($env:REDIS_SERVICE) { $env:REDIS_SERVICE } else { "redis" }),
    [int]$Limit = $(if ($env:MAX_CONCURRENT_CONNECTIONS) { [int]$env:MAX_CONCURRENT_CONNECTIONS } else { 6 })
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$healthUrl = "http://${GatewayHost}:${GatewayPort}/health"
try {
    Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 5 | Out-Null
} catch {
    throw "Gateway not reachable at ${GatewayHost}:${GatewayPort}. Run: docker compose -f $ComposeFile up -d --build"
}

function Read-TcpHttpResponse {
    param(
        [System.Net.Sockets.TcpClient]$Client,
        [int]$TimeoutMs = 8000
    )
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
        } catch [System.IO.IOException] {
            break
        }
    }
    return $sb.ToString()
}

Write-Host "== admission 503 (hold $Limit connections) =="
$holders = New-Object System.Collections.Generic.List[System.Net.Sockets.TcpClient]
try {
    for ($i = 0; $i -lt $Limit; $i++) {
        $c = [System.Net.Sockets.TcpClient]::new()
        $c.Connect($GatewayHost, $GatewayPort)
        $holders.Add($c) | Out-Null
    }
    Start-Sleep -Milliseconds 300

    $probe = [System.Net.Sockets.TcpClient]::new()
    $probe.Connect($GatewayHost, $GatewayPort)
    $resp = Read-TcpHttpResponse -Client $probe
    $probe.Close()

    if ($resp -notmatch "503") {
        throw "expected HTTP 503 on saturated admission, got: '$resp'"
    }
    Write-Host "admission 503 OK"
} finally {
    foreach ($c in $holders) { $c.Close() }
}
Start-Sleep -Milliseconds 500

Write-Host "== Redis chaos (stop $RedisService -> CONNECT 407) =="
docker compose -f $ComposeFile stop $RedisService
if ($LASTEXITCODE -ne 0) { throw "docker compose stop redis failed" }

try {
    Start-Sleep -Seconds 5
    $auth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("smoke-user:smoke-pass"))
    $req = "CONNECT example.com:443 HTTP/1.1`r`nHost: example.com:443`r`nProxy-Authorization: Basic $auth`r`n`r`n"

    $client = [System.Net.Sockets.TcpClient]::new()
    $client.Connect($GatewayHost, $GatewayPort)
    $stream = $client.GetStream()
    $bytes = [Text.Encoding]::ASCII.GetBytes($req)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
    $connectResp = Read-TcpHttpResponse -Client $client
    $client.Close()

    if ($connectResp -notmatch "407") {
        throw "expected 407 after Redis stop, got: '$connectResp'"
    }
    Write-Host "Redis-down CONNECT 407 OK"
} finally {
    docker compose -f $ComposeFile start $RedisService | Out-Null
    Start-Sleep -Seconds 3
}

try {
    Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 10 | Out-Null
    Write-Host "health OK after Redis restart"
} catch {
    Write-Host "warn: /health not OK after Redis restart"
}

Write-Host "P2 resilience smoke complete."

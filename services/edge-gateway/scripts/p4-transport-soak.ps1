# P4 transport soak: hold many authenticated buyer CONNECT tunnels through provider yamux/QUIC.
# Prereq: main stack + provider (QUIC overlay). See docs/P4_TRANSPORT_SOAK_RUNBOOK.md
param(
    [int]$GatewayPort = $(if ($env:EDGE_GATEWAY_PORT) { [int]$env:EDGE_GATEWAY_PORT } else { 8090 }),
    [int]$MetricsPort = $(if ($env:EDGE_GATEWAY_METRICS_PORT) { [int]$env:EDGE_GATEWAY_METRICS_PORT } else { 9092 }),
    [string]$ApiBaseUrl = "",
    [int]$TargetConcurrent = $(if ($env:SOAK_CONCURRENT) { [int]$env:SOAK_CONCURRENT } else { 200 }),
    [int]$DurationSec = $(if ($env:SOAK_DURATION_SEC) { [int]$env:SOAK_DURATION_SEC } else { 300 }),
    [int]$SampleIntervalSec = 30,
    [int]$RampBatch = 20,
    [string]$ConnectHost = "example.com",
    [int]$ConnectPort = 443,
    [string]$OutFile = "docs/P4_TRANSPORT_SOAK.md",
    [switch]$SkipPrereqCheck
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$RepoRoot = Split-Path -Parent (Split-Path -Parent $Root)
Set-Location $Root

function Import-DotEnv([string]$Path) {
    if (-not (Test-Path $Path)) { return }
    Get-Content $Path | ForEach-Object {
        $line = $_.Trim()
        if ($line -eq "" -or $line.StartsWith("#")) { return }
        if ($line -match '^\s*([^#=]+)=(.*)$') {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim().Trim('"').Trim("'")
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
}

function Read-TcpHttpHeaders {
    param(
        [System.Net.Sockets.TcpClient]$Client,
        [int]$TimeoutMs = 15000
    )
    $stream = $Client.GetStream()
    $stream.ReadTimeout = $TimeoutMs
    $buf = New-Object byte[] 8192
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

function Get-MetricValue([string]$text, [string]$name) {
    $m = [regex]::Match($text, "(?m)^$([regex]::Escape($name))\s+([0-9.eE+-]+)")
    if ($m.Success) { return $m.Groups[1].Value }
    return $null
}

function Get-SoakRedisUrl {
    if (-not $env:REDIS_PASSWORD) { throw "REDIS_PASSWORD missing from .env" }
    $port = if ($env:REDIS_HOST_PORT) { $env:REDIS_HOST_PORT } else { "6379" }
    $pass = [Uri]::EscapeDataString($env:REDIS_PASSWORD)
    return "redis://:${pass}@127.0.0.1:${port}"
}

function Set-SoakRedisValue {
    param(
        [string]$Key,
        [string]$Value,
        [int]$TtlSec = 3600,
        [string]$RedisUrl = $(Get-SoakRedisUrl)
    )
    $path = Join-Path $env:TEMP "p4-soak-redis-$([guid]::NewGuid().ToString('N')).json"
    [System.IO.File]::WriteAllText($path, $Value, (New-Object System.Text.UTF8Encoding $false))
    $seedDir = Join-Path $RepoRoot "services\control-api"
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    Push-Location $seedDir
    try {
        $out = go run ./cmd/p3_seed_redis -redis $RedisUrl -key $Key -file $path -ttl $TtlSec 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0) { throw "p3_seed_redis failed for ${Key}: $out" }
    } finally {
        Pop-Location
        $ErrorActionPreference = $prevEap
        Remove-Item $path -Force -ErrorAction SilentlyContinue
    }
}

function Test-ConnectEstablished([string]$Response) {
    return $Response -match "HTTP/1\.[01] (200|502|504)"
}

Import-DotEnv (Join-Path $RepoRoot ".env")
if (-not $ApiBaseUrl) {
    $apiPort = if ($env:CONTROL_API_HOST_PORT) { $env:CONTROL_API_HOST_PORT } else { "18080" }
    $ApiBaseUrl = "http://localhost:$apiPort"
}

$metricsUrl = "http://127.0.0.1:${MetricsPort}/metrics"
$healthUrl = "http://127.0.0.1:${GatewayPort}/health"

Write-Host "== P4 transport soak ==" -ForegroundColor Cyan
Write-Host "Gateway buyer :$GatewayPort | metrics :$MetricsPort | target=$TargetConcurrent | duration=${DurationSec}s"

if (-not $SkipPrereqCheck) {
    Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 10 | Out-Null
    $m0 = (Invoke-WebRequest -Uri $metricsUrl -UseBasicParsing -TimeoutSec 10).Content
    $hp = Get-MetricValue $m0 "edge_gateway_healthy_providers"
    if ([int]$hp -lt 1) {
        throw "edge_gateway_healthy_providers=$hp - start provider stack: .\scripts\compose-up-dev.ps1"
    }
    Write-Host "OK healthy_providers=$hp"
}

$composeEnv = Join-Path $RepoRoot "config\docker\provider.compose.env"
if (-not (Test-Path $composeEnv)) {
    throw "Missing $composeEnv - run .\scripts\bootstrap-provider-docker.ps1"
}
$apiKey = $null
Get-Content $composeEnv | ForEach-Object {
    if ($_ -match '^\s*PROXYHUB_API_KEY=(.+)$') { $apiKey = $matches[1].Trim().Trim('"') }
}
if (-not $apiKey) { throw "PROXYHUB_API_KEY not found in provider.compose.env" }

$authBody = @{ token = $apiKey } | ConvertTo-Json
$authResp = Invoke-RestMethod -Uri ($ApiBaseUrl.TrimEnd('/') + "/v1/provider/auth") -Method Post `
    -Body $authBody -ContentType "application/json" -TimeoutSec 20
if (-not $authResp.valid) { throw "provider auth invalid: $($authResp.message)" }
$userId = $authResp.user_id
$runtimeNodeId = "node_$userId"
Write-Host "OK provider user_id=$userId runtime_node_id=$runtimeNodeId"

$sessionUser = "soak-$([guid]::NewGuid().ToString('N').Substring(0,8))"
$sessionPass = "soak-pass"
$sessionId = [guid]::NewGuid().ToString()
$now = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$expires = (Get-Date).ToUniversalTime().AddHours(6).ToString("yyyy-MM-ddTHH:mm:ssZ")
$sessionObj = @{
    user_id         = $userId
    session_id      = $sessionId
    provider_id     = ""
    type            = "sticky"
    status          = "active"
    bandwidth_limit = 10737418240
    bandwidth_used  = 0
    trust_tier      = "verified"
    target_geo      = ""
    created_at      = $now
    expires_at      = $expires
}
$sessionJson = $sessionObj | ConvertTo-Json -Compress
Set-SoakRedisValue -Key "session:$sessionUser" -Value $sessionJson
Set-SoakRedisValue -Key "sticky:$sessionId" -Value $runtimeNodeId
Write-Host "OK seeded session:$sessionUser and sticky:$sessionId -> $runtimeNodeId"

$authB64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${sessionUser}:${sessionPass}"))
$target = "${ConnectHost}:${ConnectPort}"
$connectReq = @(
    "CONNECT $target HTTP/1.1",
    "Host: $target",
    "Proxy-Authorization: Basic $authB64",
    "",
    ""
) -join "`r`n"

$holders = New-Object System.Collections.Generic.List[System.Net.Sockets.TcpClient]
$connectOk = 0
$connectFail = 0
$firstFailSnippet = $null
$samples = New-Object System.Collections.Generic.List[object]
$maxRampBatches = [Math]::Max(5, [int][Math]::Ceiling($TargetConcurrent / [Math]::Max(1, $RampBatch)) + 3)
$batchNum = 0

try {
    Write-Host "Ramping CONNECT tunnels (batch=$RampBatch, max_batches=$maxRampBatches)..."
    while ($holders.Count -lt $TargetConcurrent -and $batchNum -lt $maxRampBatches) {
        $batchNum++
        $heldBefore = $holders.Count
        $batchEnd = [Math]::Min($TargetConcurrent, $holders.Count + $RampBatch)
        for ($i = $holders.Count; $i -lt $batchEnd; $i++) {
            try {
                $tcp = New-Object System.Net.Sockets.TcpClient
                $tcp.Connect("127.0.0.1", $GatewayPort)
                $stream = $tcp.GetStream()
                $bytes = [Text.Encoding]::ASCII.GetBytes($connectReq)
                $stream.Write($bytes, 0, $bytes.Length)
                $stream.Flush()
                $resp = Read-TcpHttpHeaders -Client $tcp
                if (Test-ConnectEstablished $resp) {
                    $holders.Add($tcp) | Out-Null
                    $connectOk++
                } else {
                    $connectFail++
                    if (-not $firstFailSnippet -and $resp) {
                        $firstFailSnippet = ($resp -split "`r`n" | Select-Object -First 4) -join " | "
                    }
                    $tcp.Close()
                }
            } catch {
                $connectFail++
                if (-not $firstFailSnippet) {
                    $firstFailSnippet = $_.Exception.Message
                }
            }
        }
        Write-Host "  batch=$batchNum open=$($holders.Count) ok=$connectOk fail=$connectFail"
        if ($holders.Count -ge $TargetConcurrent) { break }
        if ($holders.Count -eq $heldBefore -and $connectFail -gt 0) {
            Write-Host "WARN: ramp batch made no progress" -ForegroundColor Yellow
        }
        Start-Sleep -Milliseconds 500
    }
    if ($firstFailSnippet) {
        Write-Host "First CONNECT failure: $firstFailSnippet"
    }

    if ($holders.Count -lt 1) {
        throw "No CONNECT tunnels established (fail=$connectFail). Check provider routing and session seed."
    }
    if ($holders.Count -lt [Math]::Min(10, $TargetConcurrent)) {
        Write-Host "WARN: only $($holders.Count) tunnels held (target $TargetConcurrent)" -ForegroundColor Yellow
    }

    $deadline = (Get-Date).AddSeconds($DurationSec)
    Write-Host "Soaking $($holders.Count) tunnels for ${DurationSec}s (sample every ${SampleIntervalSec}s)..."
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds $SampleIntervalSec
        try {
            $mb = (Invoke-WebRequest -Uri $metricsUrl -UseBasicParsing -TimeoutSec 30).Content
            $sample = [ordered]@{
                ts               = (Get-Date).ToString("o")
                held             = $holders.Count
                active_sessions  = Get-MetricValue $mb "edge_gateway_active_sessions"
                active_conns     = Get-MetricValue $mb "edge_gateway_active_connections"
                healthy_providers = Get-MetricValue $mb "edge_gateway_healthy_providers"
                rss_bytes        = Get-MetricValue $mb "process_resident_memory_bytes"
            }
            $samples.Add($sample) | Out-Null
            Write-Host ("  {0} held={1} active_sessions={2} healthy_providers={3}" -f `
                $sample.ts, $sample.held, $sample.active_sessions, $sample.healthy_providers)
            if ([int]$sample.healthy_providers -lt 1) {
                throw "Provider dropped during soak (healthy_providers=0)"
            }
        } catch {
            Write-Host "WARN metrics sample failed: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
} finally {
    foreach ($c in $holders) {
        try { $c.Close() } catch { }
    }
    $holders.Clear()
}

Start-Sleep -Seconds 5
$healthOk = $false
foreach ($attempt in 1..6) {
    try {
        Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 30 | Out-Null
        $healthOk = $true
        break
    } catch {
        Write-Host "WARN health check attempt $attempt failed: $($_.Exception.Message)" -ForegroundColor Yellow
        Start-Sleep -Seconds 5
    }
}
if (-not $healthOk) {
    Write-Host "WARN: /health did not recover within retries (gateway may still be draining)" -ForegroundColor Yellow
} else {
    Write-Host "OK health after tunnel release"
}

$gwLog = docker logs proxyhubb-edge-gateway-1 2>&1 | Select-Object -Last 5 | Out-String
$transport = "unknown"
if ($gwLog -match "provider_transport=Quic|PROVIDER_TRANSPORT=quic|Provider QUIC") { $transport = "quic" }
elseif ($gwLog -match "yamux") { $transport = "yamux" }

$lines = @()
$lines += ""
$lines += "## Run $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')"
$lines += ""
$lines += "Machine: $env:COMPUTERNAME"
$lines += "Transport (from gateway logs): $transport"
$lines += "Gateway buyer port: $GatewayPort | metrics: $MetricsPort"
$lines += "Target concurrent: $TargetConcurrent | held: $($connectOk) | connect failures: $connectFail"
$lines += "Health after release: $(if ($healthOk) { '200 OK' } else { 'timeout (restart edge-gateway if stuck unhealthy)' })"
$lines += "Duration: ${DurationSec}s | CONNECT dest: $target"
$lines += "Provider node: $runtimeNodeId"
$lines += ""
$lines += "### Samples"
$lines += ""
foreach ($s in $samples) {
    $lines += "- ``$($s.ts)`` held=$($s.held) active_sessions=$($s.active_sessions) active_connections=$($s.active_conns) healthy_providers=$($s.healthy_providers) rss=$($s.rss_bytes)"
}
$lines += ""
$lines += "### Pass criteria (dev soak)"
$lines += ""
$lines += "- At least one CONNECT tunnel established through provider transport"
$lines += "- ``edge_gateway_healthy_providers`` >= 1 for all samples"
$lines += "- ``/health`` 200 after releasing tunnels"
$lines += "- Load lab target: 10k+ concurrent streams (raise ``SOAK_CONCURRENT`` on dedicated hardware)"
$lines += ""

$outPath = Join-Path $Root $OutFile
if (-not (Test-Path $outPath)) {
    $header = @(
        "# P4 transport soak snapshots",
        "",
        "Auto-appended by ``scripts/p4-transport-soak.ps1``. See ``P4_TRANSPORT_SOAK_RUNBOOK.md``.",
        ""
    ) -join "`n"
    Set-Content -Path $outPath -Value $header -Encoding UTF8
}
Add-Content -Path $outPath -Value ($lines -join "`n") -Encoding UTF8

Write-Host ""
Write-Host "P4 transport soak complete. Appended snapshot to $OutFile" -ForegroundColor Green
if ($connectOk -lt [Math]::Max(1, [int]($TargetConcurrent * 0.5))) {
    Write-Host "WARN: held fewer than 50% of target tunnels - investigate before load lab" -ForegroundColor Yellow
}

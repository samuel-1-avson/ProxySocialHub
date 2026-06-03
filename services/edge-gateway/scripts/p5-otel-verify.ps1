# P5: verify RED metrics on /metrics (and print OTLP dev hints).
param(
    [string]$MetricsUrl = "",
    [string]$OtelEndpoint = "http://127.0.0.1:4317",
    [int]$WaitSeconds = 0,
    [switch]$Strict
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$EdgeDir = Join-Path $RepoRoot "services\edge-gateway"

function Get-GatewayMetricsCandidates {
    $urls = [System.Collections.Generic.List[string]]::new()

    if ($env:EDGE_GATEWAY_METRICS_URL) {
        $urls.Add($env:EDGE_GATEWAY_METRICS_URL.TrimEnd('/'))
        if (-not $urls[-1].EndsWith('/metrics')) {
            $urls[$urls.Count - 1] = "$($urls[-1])/metrics"
        }
    }

    $portEnv = $env:EDGE_GATEWAY_PORT
    if ($portEnv) {
        $urls.Add("http://127.0.0.1:$portEnv/metrics")
    }

  # Default compose mappings (see docker ps; host port often != 8090)
    foreach ($p in @(8090, 18090, 28090, 28091, 28100, 28101, 28110, 28111)) {
        $urls.Add("http://127.0.0.1:$p/metrics")
    }

    if (Get-Command docker -ErrorAction SilentlyContinue) {
        $all = docker ps --format "{{.Names}}" 2>$null
        # Prefer main-stack gateway before P3/P3-split replicas (avoids stale :28090 images).
        $primary = $all | Where-Object {
            $_ -eq 'proxyhubb-edge-gateway' -or $_ -eq 'proxyhubb-edge-gateway-1'
        }
        $p3 = $all | Where-Object { $_ -match 'edge-p3-edge|edge-p3-split-edge' }
        foreach ($name in @($primary + $p3)) {
            $mapping = docker port $name 8090/tcp 2>$null
            if ($mapping -match ':(\d+)$') {
                $hostPort = $Matches[1]
                $urls.Insert(0, "http://127.0.0.1:${hostPort}/metrics")
            }
        }
    }

    ($urls | Select-Object -Unique)
}

function Wait-ForMetrics([string]$Url, [int]$Seconds) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    do {
        try {
            $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
            if ($r.StatusCode -eq 200) { return $r }
        } catch { }
        if ((Get-Date) -lt $deadline) {
            Start-Sleep -Seconds 2
        }
    } while ((Get-Date) -lt $deadline)
    return $null
}

if ([string]::IsNullOrWhiteSpace($MetricsUrl)) {
    $candidates = Get-GatewayMetricsCandidates
} else {
    $u = $MetricsUrl.TrimEnd('/')
    if ($u -notmatch '/metrics$') { $u = "$u/metrics" }
    $candidates = @($u)
}

$body = $null
$usedUrl = $null
foreach ($url in $candidates) {
    Write-Host "Trying $url ..."
    if ($WaitSeconds -gt 0) {
        $body = Wait-ForMetrics $url $WaitSeconds
    } else {
        try {
            $body = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
        } catch { $body = $null }
    }
    if ($null -ne $body) {
        $usedUrl = $url
        break
    }
}

if ($null -eq $body) {
    Write-Host ""
    Write-Host "No edge-gateway /metrics endpoint responded." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Start the stack (pick one):"
    Write-Host "  docker compose -f infra/docker-compose/docker-compose.yml up -d edge-gateway"
    Write-Host "  docker compose up -d edge-gateway    # if using repo-root compose"
    Write-Host ""
    Write-Host "Then check the HOST port (not always 8090):"
    Write-Host '  docker ps --format "table {{.Names}}\t{{.Ports}}" | findstr gateway'
    Write-Host ""
    Write-Host "Re-run with the mapped port, e.g.:"
    Write-Host "  .\services\edge-gateway\scripts\p5-otel-verify.ps1 -MetricsUrl http://127.0.0.1:18090/metrics"
    Write-Host "  .\services\edge-gateway\scripts\p5-otel-verify.ps1 -WaitSeconds 60   # wait for startup"
    Write-Host ""
    Write-Host "Local cargo (from services/edge-gateway, needs Redis/control-api env):"
    Write-Host "  cd services\edge-gateway"
    Write-Host "  cargo run --features otel"
    exit 1
}

Write-Host "OK: metrics at $usedUrl" -ForegroundColor Green

$core = @("edge_gateway_request_latency_seconds")
$p5 = @(
    "edge_gateway_active_connections",
    "edge_gateway_total_connections",
    "edge_gateway_provider_route_selection_total",
    "edge_gateway_healthy_providers"
)

$missingCore = @()
$missingP5 = @()
foreach ($m in $core) {
    if ($body.Content -notmatch [regex]::Escape($m)) { $missingCore += $m }
}
foreach ($m in $p5) {
    if ($body.Content -notmatch [regex]::Escape($m)) { $missingP5 += $m }
}

if ($missingCore.Count -gt 0) {
    Write-Error "Metrics endpoint up but missing core families: $($missingCore -join ', ')"
}

Write-Host "OK: core RED metrics present (request latency histogram)"

if ($missingP5.Count -gt 0) {
    Write-Host ""
    Write-Host "Note: P5 metric families not in this image yet:" -ForegroundColor Yellow
    Write-Host "  $($missingP5 -join ', ')"
    Write-Host "Rebuild and restart edge-gateway to pick up latest code:"
    Write-Host "  docker compose build edge-gateway"
    Write-Host "  docker compose up -d edge-gateway"
    if ($Strict) { exit 2 }
}

Write-Host ""
Write-Host "OTLP (optional) - run from $EdgeDir :"
Write-Host "  cd services\edge-gateway"
Write-Host "  `$env:OTEL_EXPORTER_OTLP_ENDPOINT = '$OtelEndpoint'"
Write-Host "  `$env:OTEL_SERVICE_NAME = 'edge-gateway'"
Write-Host "  cargo run --features otel"
Write-Host ""
Write-Host "Grafana: .\services\edge-gateway\scripts\p5-observability-up.ps1  (-WithOtel for OTLP collector + otel image)"

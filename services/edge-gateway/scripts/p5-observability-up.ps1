# Start Prometheus + Grafana (docker-compose.dev) and verify edge-gateway metrics.
param(
    [string]$ComposeFile = "",
    [switch]$SkipVerify,
    [switch]$WithOtel
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
if ([string]::IsNullOrWhiteSpace($ComposeFile)) {
    $ComposeFile = Join-Path $RepoRoot "docker-compose.dev.yml"
}

Push-Location $RepoRoot
try {
  if ($WithOtel) {
    $env:EDGE_GATEWAY_ENABLE_OTEL = "1"
    $env:OTEL_EXPORTER_OTLP_ENDPOINT = "http://otel-collector:4317"
    Write-Host "Building edge-gateway with OTLP (ENABLE_OTEL=1)..."
    docker compose -f $ComposeFile build edge-gateway --build-arg ENABLE_OTEL=1
    if ($LASTEXITCODE -ne 0) {
      throw "edge-gateway build failed (see transport_bench stub in Dockerfile.dev if Cargo.toml parse error)."
    }
  }

  $services = @("prometheus", "grafana")
  if ($WithOtel) { $services = @("otel-collector") + $services }
  Write-Host "Starting $($services -join ', ') (observability only; edge-gateway unchanged unless build above succeeded)..."
  if ($WithOtel) {
    docker compose -f $ComposeFile --profile otel up -d @services
  } else {
    docker compose -f $ComposeFile up -d @services
  }
  if ($LASTEXITCODE -ne 0) { throw "docker compose up failed." }

  if ($WithOtel) {
    Write-Host "Recreating edge-gateway with OTEL_EXPORTER_OTLP_ENDPOINT..."
    docker compose -f $ComposeFile --profile otel up -d edge-gateway
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "edge-gateway did not start (often control-api/redis unhealthy on docker-compose.dev). Fix deps or use root docker-compose.yml:"
      Write-Warning "  docker compose build edge-gateway --build-arg ENABLE_OTEL=1"
      Write-Warning "  docker compose up -d edge-gateway"
    }
  }

    if (-not $SkipVerify) {
        Start-Sleep -Seconds 5
        & (Join-Path $PSScriptRoot "p5-otel-verify.ps1") -Strict
    }

    Write-Host ""
    Write-Host "Prometheus: http://localhost:9090"
    Write-Host "Grafana:    http://localhost:3001  (admin / `$env:GRAFANA_ADMIN_PASSWORD or 'admin')"
    Write-Host "Dashboard:  Edge Gateway folder -> Edge Gateway RED"
    if ($WithOtel) {
        Write-Host "OTLP:       docker logs proxyhubb-edge-gateway-1 2>&1 | Select-String OTLP"
        Write-Host "            (or proxyhubb-edge-gateway on docker-compose.dev)"
        Write-Host "Collector:  docker logs proxyhubb-otel-collector --tail 20"
    }
} finally {
    Pop-Location
}

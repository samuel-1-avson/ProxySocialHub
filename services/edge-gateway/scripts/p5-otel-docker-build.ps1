# Rebuild edge-gateway with OTLP tracing and restart without recreating postgres/redis/nats.
param(
    [string]$ComposeFile = "",
    [switch]$NoCache,
    [switch]$RecreateDeps
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
if ([string]::IsNullOrWhiteSpace($ComposeFile)) {
    $ComposeFile = Join-Path $RepoRoot "docker-compose.yml"
}

$env:EDGE_GATEWAY_ENABLE_OTEL = "1"
$env:OTEL_EXPORTER_OTLP_ENDPOINT = "http://otel-collector:4317"

Push-Location $RepoRoot
try {
    $buildArgs = @(
        "compose", "-f", $ComposeFile,
        "build", "edge-gateway",
        "--build-arg", "ENABLE_OTEL=1"
    )
    if ($NoCache) { $buildArgs += "--no-cache" }
    Write-Host "Building edge-gateway with --features otel ..."
    & docker @buildArgs
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    Write-Host "Starting otel-collector (profile otel)..."
    docker compose -f $ComposeFile --profile otel up -d otel-collector
    if ($LASTEXITCODE -ne 0) {
        throw "otel-collector missing in compose file. Use docker-compose.yml (root) or docker-compose.dev.yml."
    }

    if ($RecreateDeps) {
        Write-Host "Starting edge-gateway with dependencies (may recreate postgres/redis)..."
        docker compose -f $ComposeFile --profile otel up -d edge-gateway
    } else {
        Write-Host "Recreating edge-gateway only (--no-deps; control-api must already be healthy)..."
        docker compose -f $ComposeFile up -d --no-deps --force-recreate edge-gateway
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        $healthy = docker inspect --format "{{.State.Health.Status}}" proxyhubb-control-api-1 2>$null
        if ($healthy -ne "healthy") {
            Write-Warning "control-api is not healthy — edge-gateway may not pass /health. Fix stack first:"
            Write-Warning "  .\scripts\compose-heal-postgres-password.ps1 -RunMigrate"
            Write-Warning "  docker compose up -d control-api"
        }
    }

    Write-Host ""
    Write-Host "Check logs:"
    Write-Host "  docker logs proxyhubb-edge-gateway-1 2>&1 | Select-String OTLP"
    Write-Host "  docker logs proxyhubb-otel-collector --tail 20"
    Write-Host "  .\services\edge-gateway\scripts\p5-otel-verify.ps1 -Strict -MetricsUrl http://127.0.0.1:18090/metrics"
} finally {
    Pop-Location
}

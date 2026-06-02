# Stop duplicate / legacy edge-gateway Docker stacks. Keeps proxyhubb dev + edge-p3 by default.
param(
    [switch]$KeepP3,
    [switch]$KeepResilience,
    [switch]$RebuildDevGateway
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$RepoRoot = Split-Path -Parent (Split-Path -Parent $Root)

. "$PSScriptRoot\p3-compose.ps1"

Write-Host "== Edge gateway Docker cleanup =="

# Legacy fixed container_name (pre edge-p3 project)
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "SilentlyContinue"
Remove-LegacyP3Containers
$ErrorActionPreference = $prevEap

# Duplicate resilience projects (same file, two project names)
foreach ($proj in @("edge-gateway", "edge-resilience")) {
    Write-Host "Stopping compose project: $proj (resilience file)"
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    docker compose -p $proj -f (Join-Path $Root "docker-compose.resilience.yml") down --remove-orphans 2>&1 | Out-Host
    $ErrorActionPreference = $prev
}

if (-not $KeepP3) {
    Write-Host "Stopping compose project: edge-p3"
    Invoke-P3Compose @("down", "--remove-orphans")
} else {
    Write-Host "Keeping edge-p3 stack (KeepP3)"
}

# Orphan containers that sometimes survive
foreach ($name in @(
        "proxyhubb-edge-test-gateway",
        "proxyhubb-edge-test-redis",
        "proxyhubb-p3-redis",
        "proxyhubb-p3-edge-a",
        "proxyhubb-p3-edge-b"
    )) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    $null = docker rm -f $name 2>&1
    $ErrorActionPreference = $prev
}

Write-Host ""
Write-Host "Running stacks (edge-related):"
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Ports}}" |
    Select-String -Pattern "edge|8090|3128|28090|18090|13128|23128|proxyhubb-edge"

if ($RebuildDevGateway) {
    Write-Host ""
    Write-Host "Rebuilding proxyhubb-edge-gateway from repo root..."
    Push-Location $RepoRoot
    $envFile = Join-Path $RepoRoot ".env"
    $composeArgs = @("-f", "docker-compose.yml", "-f", "docker-compose.dev.yml")
    if (Test-Path $envFile) { $composeArgs = @("--env-file", $envFile) + $composeArgs }
    docker compose @composeArgs build edge-gateway
    docker compose @composeArgs up -d edge-gateway
    Pop-Location
}

Write-Host ""
Write-Host "Done. See docs/DOCKER_STACKS.md for port matrix."

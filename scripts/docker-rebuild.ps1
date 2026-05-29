param(
    [string]$ComposeFile = "docker-compose.dev.yml",
    [switch]$NoCache,
    [switch]$Up,
    [string[]]$Services = @("db-migrate", "control-api", "web")
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not (Test-Path ".env")) {
    if (Test-Path ".env.docker.example") {
        Copy-Item ".env.docker.example" ".env"
        Write-Host "Created .env from .env.docker.example — review secrets before production."
    } else {
        Write-Warning ".env missing; compose may fail on required variables."
    }
}

$buildArgs = @("compose", "-f", $ComposeFile, "build")
if ($NoCache) { $buildArgs += "--no-cache" }
$buildArgs += $Services

Write-Host "docker $($buildArgs -join ' ')"
& docker @buildArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if ($Up) {
    & docker compose -f $ComposeFile up -d
    exit $LASTEXITCODE
}

Write-Host "Build finished. Start with: docker compose -f $ComposeFile up -d"

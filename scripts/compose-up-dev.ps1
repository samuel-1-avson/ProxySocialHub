# Start the default Docker dev stack with provider QUIC tunnel (gateway + provider-node).
# Loads .env, syncs Postgres password if needed, then compose up with provider overlay.
#
# Usage:
#   .\scripts\compose-up-dev.ps1
#   .\scripts\compose-up-dev.ps1 -SkipHeal

param(
    [switch]$SkipHeal
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $RepoRoot

function Import-DotEnv([string]$Path) {
    if (-not (Test-Path $Path)) {
        throw "Missing $Path - copy .env.example to .env and fill secrets."
    }
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

Import-DotEnv (Join-Path $RepoRoot ".env")

if ([string]::IsNullOrWhiteSpace($env:POSTGRES_PASSWORD)) {
    throw "POSTGRES_PASSWORD is empty in .env - db-migrate will fail."
}

if (-not $SkipHeal) {
    Write-Host "Syncing Postgres role password with compose..."
    & (Join-Path $RepoRoot "scripts\compose-heal-postgres-password.ps1")
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$composeArgs = @(
    "compose",
    "-f", "docker-compose.yml",
    "-f", "docker-compose.provider.yml",
    "--profile", "provider",
    "up", "-d"
)

Write-Host "docker $($composeArgs -join ' ')"
docker @composeArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Dev stack up (QUIC provider tunnel). Metrics: http://127.0.0.1:$(if ($env:EDGE_GATEWAY_METRICS_PORT) { $env:EDGE_GATEWAY_METRICS_PORT } else { '9092' })/metrics"
Write-Host "Buyer: http://127.0.0.1:$($env:EDGE_GATEWAY_PORT)/health (default host 8090; check .env EDGE_GATEWAY_PORT)"

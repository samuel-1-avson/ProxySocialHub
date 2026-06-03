# Align Postgres role password with what docker compose uses for DATABASE_URL.
# Use when db-migrate fails with: password authentication failed for user "proxyhubb"
#
# Compose prefers shell POSTGRES_PASSWORD over .env — if they differ, migrate fails
# even though the DB volume was initialized with another password.

param(
    [string]$PostgresContainer = "",
    [switch]$RunMigrate
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

$pgPassword = $env:POSTGRES_PASSWORD
if ([string]::IsNullOrWhiteSpace($pgPassword) -and (Test-Path (Join-Path $RepoRoot ".env"))) {
    $line = Get-Content (Join-Path $RepoRoot ".env") |
        Where-Object { $_ -match '^\s*POSTGRES_PASSWORD=' } |
        Select-Object -First 1
    if ($line) {
        $pgPassword = ($line -replace '^\s*POSTGRES_PASSWORD=', '').Trim().Trim('"').Trim("'")
    }
}

if ([string]::IsNullOrWhiteSpace($pgPassword)) {
    throw "Set POSTGRES_PASSWORD in your shell or in .env (must match what docker compose injects)."
}

if ([string]::IsNullOrWhiteSpace($PostgresContainer)) {
    $PostgresContainer = docker ps --format "{{.Names}}" |
        Where-Object { $_ -match '^proxyhubb-postgres' } |
        Select-Object -First 1
}

if ([string]::IsNullOrWhiteSpace($PostgresContainer)) {
    throw "No running proxyhubb-postgres container found."
}

$sql = "ALTER USER proxyhubb WITH PASSWORD '" + ($pgPassword -replace "'", "''") + "';"
Write-Host "Syncing password for role proxyhubb on $PostgresContainer (length $($pgPassword.Length))..."
docker exec $PostgresContainer psql -U proxyhubb -d proxyhubb -c $sql | Out-Null

if ($env:POSTGRES_PASSWORD) {
    Write-Host "Using shell POSTGRES_PASSWORD (compose uses this over .env)."
} else {
    Write-Host "Using POSTGRES_PASSWORD from .env; export it in your shell to avoid drift."
}

if ($RunMigrate) {
    Push-Location $RepoRoot
    try {
        docker compose run --rm --no-deps db-migrate
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        Write-Host "db-migrate OK"
    } finally {
        Pop-Location
    }
}

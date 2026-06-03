# Ensures infra/oracle-keypair.json exists for Docker mounts (placeholder or copy from example).
# Does not overwrite an existing file.

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Target = Join-Path $RepoRoot "infra\oracle-keypair.json"
$Example = Join-Path $RepoRoot "infra\oracle-keypair.json.example"

if (Test-Path $Target) {
    Write-Host "Oracle keypair present: $Target"
    exit 0
}

if (-not (Test-Path $Example)) {
    throw "Missing $Example"
}

Copy-Item -Path $Example -Destination $Target
Write-Host "Created placeholder oracle keypair at $Target (replace before production/devnet funds)." -ForegroundColor Yellow

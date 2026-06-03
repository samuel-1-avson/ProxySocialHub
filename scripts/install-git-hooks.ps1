# Install repo .githooks/pre-commit (does not change global git config).
$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$src = Join-Path $RepoRoot ".githooks\pre-commit"
$dest = Join-Path $RepoRoot ".git\hooks\pre-commit"
if (-not (Test-Path $src)) { throw "Missing $src" }
Copy-Item -Path $src -Destination $dest -Force
Write-Host "Installed $dest from .githooks/pre-commit"

# Run proxyhubb-cli from the repo without installing to PATH.
$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "provider-paths.ps1")
$envFile = Join-Path $repoRoot ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match "^\s*([^#=]+)=(.*)$") {
            $k = $matches[1].Trim()
            $v = $matches[2].Trim().Trim('"').Trim("'")
            if ($v -match '^([^#]+)') { $v = $matches[1].Trim() }
            if (-not (Get-Item -Path "env:$k" -ErrorAction SilentlyContinue)) {
                Set-Item -Path "env:$k" -Value $v
            }
        }
    }
}
if (-not $env:PROVIDER_TRANSPORT) {
    $env:PROVIDER_TRANSPORT = Get-GatewayTransport
}
$cliDir = Join-Path $repoRoot "cli"
Push-Location $cliDir
try {
    if (-not $env:PROXYHUB_CLI_DEV) { $env:PROXYHUB_CLI_DEV = "1" }
    cargo run -- @args
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}

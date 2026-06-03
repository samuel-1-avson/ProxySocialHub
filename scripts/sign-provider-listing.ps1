# Sign a marketplace listing JSON with the provider signing key used by provider-node.
#
# Usage:
#   .\scripts\sign-provider-listing.ps1 -InputPath .\listing.json -Output .\listing.signed.json
#   .\scripts\sign-provider-listing.ps1 -InputPath .\listing.json -ProofOnly
#
# By default this reads PROXYHUB_PROVIDER_SIGNING_KEY from:
#   1. current environment
#   2. config/docker/provider.compose.env

param(
    [Parameter(Mandatory = $true)]
    [Alias("Listing")]
    [string]$InputPath,
    [string]$Output = "",
    [string]$ProviderNodeId = "",
    [string]$GatewayNodeId = "",
    [string]$SigningKey = "",
    [string]$Status = "",
    [switch]$ProofOnly
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Load-DotEnv([string]$path) {
    if (-not (Test-Path $path)) { return }
    Get-Content $path | ForEach-Object {
        if ($_ -match "^\s*([^#=]+)=(.*)$") {
            $k = $matches[1].Trim()
            $v = $matches[2].Trim().Trim('"').Trim("'")
            Set-Item -Path "env:$k" -Value $v
        }
    }
}

function Read-ComposeSigningKey([string]$path) {
    if (-not (Test-Path $path)) { return "" }
    $content = Get-Content $path -Raw
    if ($content -match 'PROXYHUB_PROVIDER_SIGNING_KEY=(\S+)') {
        return $matches[1].Trim()
    }
    return ""
}

Load-DotEnv (Join-Path $repoRoot ".env")

$pgUser = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { "proxyhubb" }
$pgDb = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { "proxyhubb" }
$pgPass = $env:POSTGRES_PASSWORD
$pgPort = if ($env:POSTGRES_HOST_PORT) { $env:POSTGRES_HOST_PORT } else { "55432" }
if ($pgPass -and ($env:DATABASE_URL -match '@postgres:5432' -or -not $env:DATABASE_URL)) {
    $env:DATABASE_URL = "postgresql://${pgUser}:${pgPass}@localhost:${pgPort}/${pgDb}?sslmode=disable"
}

if (-not $SigningKey -and $env:PROXYHUB_PROVIDER_SIGNING_KEY) {
    $SigningKey = $env:PROXYHUB_PROVIDER_SIGNING_KEY
}
if (-not $SigningKey) {
    $SigningKey = Read-ComposeSigningKey (Join-Path $repoRoot "config\docker\provider.compose.env")
}
if (-not $SigningKey) {
    throw "No provider signing key found. Run .\scripts\bootstrap-provider-docker.ps1 first or pass -SigningKey."
}

$resolvedInput = (Resolve-Path $InputPath).Path
Write-Host "[sign-provider-listing] Input: $resolvedInput" -ForegroundColor DarkGray
if (-not $GatewayNodeId -and $pgPass) {
    try {
        $listing = Get-Content -Path $resolvedInput -Raw | ConvertFrom-Json
        $nodeIdForLookup = if ($ProviderNodeId) { $ProviderNodeId } else { [string]$listing.provider_node_id }
        if ($nodeIdForLookup) {
            Write-Host "[sign-provider-listing] Resolving gateway_node_id for $nodeIdForLookup" -ForegroundColor DarkGray
            $gateway = docker exec -e PGPASSWORD=$pgPass proxyhubb-postgres-1 `
                psql -U $pgUser -d $pgDb -tAc "SELECT COALESCE(gateway_node_id, '') FROM provider_nodes WHERE id = '$nodeIdForLookup' LIMIT 1;" 2>$null
            if ($LASTEXITCODE -eq 0 -and $gateway) {
                $GatewayNodeId = ($gateway | Out-String).Trim()
                Write-Host "[sign-provider-listing] gateway_node_id: $GatewayNodeId" -ForegroundColor DarkGray
            }
        }
    }
    catch {
        Write-Host "[WARN] Could not auto-resolve gateway_node_id: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

$signerExe = Join-Path $env:TEMP "provider_sign_listing.exe"

$argsList = @(
    "-env-file", (Join-Path $repoRoot ".env"),
    "-input", $resolvedInput,
    "-signing-key", $SigningKey
)
if ($Output) {
    $outputPath = $Output
    if (-not [System.IO.Path]::IsPathRooted($outputPath)) {
        $outputPath = Join-Path $repoRoot $outputPath
    }
    $argsList += @("-output", $outputPath)
}
if ($ProviderNodeId) {
    $argsList += @("-provider-node-id", $ProviderNodeId)
}
if ($GatewayNodeId) {
    $argsList += @("-gateway-node-id", $GatewayNodeId)
}
if ($Status) {
    $argsList += @("-status", $Status)
}
if ($ProofOnly) {
    $argsList += "-proof-only"
}

Push-Location (Join-Path $repoRoot "services\control-api")
try {
    Write-Host "[sign-provider-listing] Building signer helper" -ForegroundColor DarkGray
    & go build -o $signerExe ./cmd/provider_sign_listing
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
    Write-Host "[sign-provider-listing] Signing listing payload" -ForegroundColor DarkGray
    & $signerExe @argsList
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}
finally {
    Pop-Location
}

if ($Output) {
    Write-Host "[OK] Signed listing written to $outputPath" -ForegroundColor Green
}

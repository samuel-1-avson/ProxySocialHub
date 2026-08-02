# Mint TEST_BUYER_JWT for Playwright devnet E2E (governance, map-buy).
# Uses JWT_SECRET + DATABASE_URL from repo .env (same as docker control-api).
#
# Usage:
#   .\scripts\mint-e2e-buyer-jwt.ps1
#   .\scripts\mint-e2e-buyer-jwt.ps1 -WalletSecret $env:NEXT_PUBLIC_PLAYWRIGHT_SOLANA_WALLET_SECRET
#   .\scripts\mint-e2e-buyer-jwt.ps1 -Wallet 8g7WUuPosAg82Uu7iGYCx6HBnoTBFb4QuyiJCEGzktU4

param(
    [string]$Wallet = "",
    [string]$WalletSecret = "",
    [string]$UserId = "",
    [switch]$EnsureBuyer,
    [string]$EnvFile = "",
    [string]$OutFile = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path $PSScriptRoot -Parent
$apiDir = Join-Path $repoRoot "services\control-api"

. (Join-Path $PSScriptRoot "_env.ps1")
Import-RepoDotEnv -RepoRoot $repoRoot
$pg = if ($env:POSTGRES_PASSWORD) { $env:POSTGRES_PASSWORD } else { "admin" }
$pgHost = if ($env:POSTGRES_HOST_PORT) { "127.0.0.1:$($env:POSTGRES_HOST_PORT)" } else { "127.0.0.1:55432" }
# Host-side mint must hit published Postgres, not docker service name "postgres".
$env:DATABASE_URL = "postgresql://proxyhubb:${pg}@${pgHost}/proxyhubb?sslmode=disable"

if (-not $WalletSecret -and $env:NEXT_PUBLIC_PLAYWRIGHT_SOLANA_WALLET_SECRET) {
    $WalletSecret = $env:NEXT_PUBLIC_PLAYWRIGHT_SOLANA_WALLET_SECRET
}

$goArgs = @("run", "./cmd/buyer_dev_token")
if ($EnvFile) { $goArgs += "-env-file", $EnvFile }
if ($UserId) { $goArgs += "-user", $UserId }
if ($EnsureBuyer) { $goArgs += "-ensure-buyer" }
if ($Wallet) {
    $goArgs += "-wallet", $Wallet
} elseif ($WalletSecret) {
    $env:NEXT_PUBLIC_PLAYWRIGHT_SOLANA_WALLET_SECRET = $WalletSecret
    $goArgs += "-wallet-from-playwright-secret"
} else {
    Write-Host "Provide -Wallet <base58> or -WalletSecret / NEXT_PUBLIC_PLAYWRIGHT_SOLANA_WALLET_SECRET" -ForegroundColor Red
    exit 1
}

$writeJson = [bool]$OutFile
if ($writeJson) {
    $goArgs += "-json"
}

function Get-BuyerDevTokenCliArgs {
    $cli = @()
    if ($EnvFile) { $cli += "-env-file", $EnvFile }
    if ($UserId) { $cli += "-user", $UserId }
    if ($EnsureBuyer) { $cli += "-ensure-buyer" }
    if ($Wallet) {
        $cli += "-wallet", $Wallet
    } elseif ($WalletSecret) {
        $cli += "-wallet-from-playwright-secret"
    }
    if ($writeJson) { $cli += "-json" }
    return $cli
}

function Invoke-BuyerDevTokenDocker {
    param([string[]]$CliArgs)
    $binPath = Join-Path $repoRoot ".tmp-buyer_dev_token"
    if (-not (Test-Path $binPath)) {
        Write-Host "Building linux buyer_dev_token for Docker mint..."
        Push-Location $apiDir
        try {
            $prevGoos = $env:GOOS
            $prevGoarch = $env:GOARCH
            $env:GOOS = "linux"
            $env:GOARCH = "amd64"
            & go build -o $binPath ./cmd/buyer_dev_token
            if ($LASTEXITCODE -ne 0) { throw "go build buyer_dev_token failed (exit $LASTEXITCODE)" }
        } finally {
            if ($null -ne $prevGoos) { $env:GOOS = $prevGoos } else { Remove-Item env:GOOS -ErrorAction SilentlyContinue }
            if ($null -ne $prevGoarch) { $env:GOARCH = $prevGoarch } else { Remove-Item env:GOARCH -ErrorAction SilentlyContinue }
            Pop-Location
        }
    }
    if (-not $env:JWT_SECRET) {
        throw "JWT_SECRET missing from .env (required for Docker mint)"
    }
    $dockerEnv = @(
        "-e", "DATABASE_URL=postgresql://proxyhubb:${pg}@postgres:5432/proxyhubb?sslmode=disable",
        "-e", "JWT_SECRET=$($env:JWT_SECRET)"
    )
    if ($WalletSecret) {
        $dockerEnv += "-e", "NEXT_PUBLIC_PLAYWRIGHT_SOLANA_WALLET_SECRET=$WalletSecret"
    }
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $all = docker run --rm --network proxyhubb_backend --entrypoint /buyer_dev_token `
        -v "${binPath}:/buyer_dev_token:ro" @dockerEnv proxyhubb-control-api:latest @CliArgs 2>&1 | Out-String
    $exit = $LASTEXITCODE
    $ErrorActionPreference = $prevEap
    if ($exit -ne 0) {
        throw "buyer_dev_token (docker) failed (exit $exit): $all"
    }
    return $all
}

function Invoke-BuyerDevTokenHost {
    param([string[]]$GoRunArgs)
    Push-Location $apiDir
    try {
        $prevEap = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        $all = (go @GoRunArgs 2>&1 | Out-String)
        $exit = $LASTEXITCODE
        $ErrorActionPreference = $prevEap
        return @{ Exit = $exit; Output = $all }
    } finally {
        Pop-Location
    }
}

$cliArgs = Get-BuyerDevTokenCliArgs

if ($writeJson) {
    $outPath = if ([System.IO.Path]::IsPathRooted($OutFile)) { $OutFile } else { Join-Path $repoRoot $OutFile }
    $result = Invoke-BuyerDevTokenHost -GoRunArgs $goArgs
    if ($result.Exit -ne 0) {
        Write-Host "Host buyer_dev_token failed; retrying via Docker network (postgres:5432)..." -ForegroundColor Yellow
        $result.Output = Invoke-BuyerDevTokenDocker -CliArgs $cliArgs
    }
    if ($result.Output -notmatch '(?s)(\{[\s\S]*\})') {
        throw "buyer_dev_token -json output did not contain JSON"
    }
    $jsonText = $matches[1].Trim()
    [System.IO.File]::WriteAllText($outPath, $jsonText + "`n")
    Write-Host "Wrote $outPath" -ForegroundColor Green
} else {
    $result = Invoke-BuyerDevTokenHost -GoRunArgs $goArgs
    if ($result.Exit -ne 0) {
        Write-Host "Host buyer_dev_token failed; retrying via Docker network (postgres:5432)..." -ForegroundColor Yellow
        Invoke-BuyerDevTokenDocker -CliArgs $cliArgs | Write-Host
    } else {
        Write-Host $result.Output
    }
}

Write-Host ""
Write-Host "Also set Solana env for devnet tests (from docs/DEV_SOLANA_SMOKE.md):" -ForegroundColor Cyan
Write-Host '  $env:NEXT_PUBLIC_SOLANA_PROGRAM_ID = "AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu"'
Write-Host '  $env:NEXT_PUBLIC_SOLANA_RPC_URL = "https://api.devnet.solana.com"'
Write-Host '  $env:NEXT_PUBLIC_PLAYWRIGHT_SOLANA_TEST_WALLET = "1"'
Write-Host ""
Write-Host "Run governance devnet against dev:e2e (Playwright wallet is build-time for Docker web):" -ForegroundColor Yellow
Write-Host "  Terminal 1: cd apps\web; npm run dev:e2e  (with env vars above)"
Write-Host '  Terminal 2: $env:TEST_BASE_URL = "http://localhost:4011"; npm run test:e2e:governance:devnet'

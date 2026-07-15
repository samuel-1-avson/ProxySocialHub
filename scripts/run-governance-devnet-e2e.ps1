# One-shot: smoke on Docker web + devnet governance E2E on dev:e2e.
# Creates/refreshes .e2e-playwright-wallet.json and .e2e-buyer-token.json if missing.
param(
    [switch]$SkipMint,
    [switch]$SmokeOnly,
    # Use Docker test-validator + Anchor program at 2yDRy… (recommended on Windows when public devnet program id is wrong).
    [switch]$UseLocalSolana
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path $PSScriptRoot -Parent
$walletFile = Join-Path $repoRoot ".e2e-playwright-wallet.json"
$tokenFile = Join-Path $repoRoot ".e2e-buyer-token.json"
$apiDir = Join-Path $repoRoot "services\control-api"
$webDir = Join-Path $repoRoot "apps\web"

# Load root .env for JWT + postgres password
$envPath = Join-Path $repoRoot ".env"
if (Test-Path $envPath) {
    Get-Content $envPath | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            $k = $matches[1].Trim()
            $v = $matches[2].Trim()
            if ($k -eq 'JWT_SECRET') { $env:JWT_SECRET = $v }
            if ($k -eq 'POSTGRES_PASSWORD') { $script:pgPass = $v }
            if ($k -eq 'SOLANA_PROGRAM_ID') { $script:solProgram = $v }
        }
    }
}
if (-not $script:pgPass) { $script:pgPass = 'admin' }
# Legacy compose default; may not exist on public devnet — prefer -UseLocalSolana or set SOLANA_PROGRAM_ID in .env
if (-not $script:solProgram) { $script:solProgram = '9MrpHTKd15GfTAcukRSqdfqtUGpEoE4Lj7u7NhdFaob2' }

if ($UseLocalSolana) {
    $script:solProgram = '2yDRyTwhHnVakKKMhhGG61V9b78RUdXRjAL3UiPwmDd7'
    Write-Host "Local Solana mode: program $script:solProgram on http://127.0.0.1:8899" -ForegroundColor Cyan
    & (Join-Path $repoRoot "scripts\solana-local\deploy-proxyhub.ps1")
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host "Recreating control-api with local RPC..." -ForegroundColor Cyan
    Push-Location $repoRoot
    $env:SOLANA_PROGRAM_ID = $script:solProgram
    docker compose -f docker-compose.dev.yml -f docker-compose.local-solana.yml build control-api 2>&1 | Out-Host
    docker compose -f docker-compose.dev.yml -f docker-compose.local-solana.yml up -d control-api --force-recreate 2>&1 | Out-Host
    Pop-Location
    Start-Sleep -Seconds 8
}

$pgPort = if ($env:POSTGRES_HOST_PORT) { $env:POSTGRES_HOST_PORT } else { "5433" }
$env:POSTGRES_HOST_PORT = $pgPort
$env:DATABASE_URL = "postgresql://proxyhubb:$($script:pgPass)@127.0.0.1:${pgPort}/proxyhubb?sslmode=disable"
$env:TEST_API_URL = "http://localhost:18080"
$env:NEXT_PUBLIC_SOLANA_PROGRAM_ID = $script:solProgram
$script:rpcUrl = if ($UseLocalSolana) { "http://127.0.0.1:8899" } else { "https://api.devnet.solana.com" }
$env:NEXT_PUBLIC_SOLANA_RPC_URL = $script:rpcUrl
$env:NEXT_PUBLIC_PLAYWRIGHT_SOLANA_TEST_WALLET = "1"
$env:E2E_LIVE_GOVERNANCE = "1"

if (-not (Test-Path $walletFile)) {
    Write-Host "Generating Playwright devnet keypair..." -ForegroundColor Cyan
    Push-Location $webDir
    $pub = node -e @"
const {Keypair}=require('@solana/web3.js');
const fs=require('fs');
const k=Keypair.generate();
const o={secret:JSON.stringify(Array.from(k.secretKey)),pubkey:k.publicKey.toBase58()};
fs.writeFileSync(process.argv[1], JSON.stringify(o));
console.log(o.pubkey);
"@ $walletFile
    Pop-Location
    Write-Host "  Wallet: $pub"
}

$w = Get-Content $walletFile | ConvertFrom-Json
$env:NEXT_PUBLIC_PLAYWRIGHT_SOLANA_WALLET_SECRET = $w.secret

if (-not $SkipMint -or -not (Test-Path $tokenFile)) {
    Write-Host "Minting TEST_BUYER_JWT..." -ForegroundColor Cyan
    & (Join-Path $repoRoot "scripts\mint-e2e-buyer-jwt.ps1") `
        -WalletSecret $w.secret `
        -EnsureBuyer `
        -OutFile $tokenFile
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$t = Get-Content $tokenFile | ConvertFrom-Json
$env:TEST_BUYER_JWT = $t.token

Write-Host "Smoke (Docker web :3009)..." -ForegroundColor Cyan
$env:TEST_BASE_URL = "http://127.0.0.1:3009"
Push-Location $webDir
npm run test:e2e:governance:smoke
if ($LASTEXITCODE -ne 0) { Pop-Location; exit $LASTEXITCODE }
Pop-Location

if ($SmokeOnly) {
    Write-Host "Smoke passed (devnet skipped)." -ForegroundColor Green
    exit 0
}

Write-Host "Fund E2E wallet (vote fees)..." -ForegroundColor Cyan
& (Join-Path $repoRoot "scripts\fund-e2e-devnet-wallet.ps1") -RpcUrl $script:rpcUrl
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Preflight devnet..." -ForegroundColor Cyan
Push-Location $webDir
npm run test:e2e:governance:devnet:check
if ($LASTEXITCODE -ne 0) { Pop-Location; exit $LASTEXITCODE }

$devPort = 4011
$probe = $null
try {
    $probe = Invoke-WebRequest -Uri "http://127.0.0.1:$devPort" -UseBasicParsing -TimeoutSec 3
} catch { }

if (-not $probe) {
    Write-Host "Starting dev:e2e on :$devPort (background)..." -ForegroundColor Cyan
    $log = Join-Path $repoRoot ".e2e-dev-server.log"
    $startCmd = @"
Set-Location '$webDir'
`$env:NEXT_PUBLIC_PLAYWRIGHT_SOLANA_TEST_WALLET='1'
`$env:NEXT_PUBLIC_PLAYWRIGHT_SOLANA_WALLET_SECRET='$($w.secret)'
`$env:NEXT_PUBLIC_SOLANA_PROGRAM_ID='$script:solProgram'
`$env:NEXT_PUBLIC_SOLANA_RPC_URL='$script:rpcUrl'
npm run dev:e2e 2>&1 | Tee-Object -FilePath '$log'
"@
    Start-Process powershell -ArgumentList "-NoProfile", "-Command", $startCmd -WindowStyle Hidden
    $deadline = (Get-Date).AddMinutes(4)
    $ready = $false
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 6
        try {
            $r = Invoke-WebRequest -Uri "http://127.0.0.1:$devPort/governance" -UseBasicParsing -TimeoutSec 8
            if ($r.StatusCode -eq 200) { $ready = $true; break }
        } catch { }
    }
    if (-not $ready) {
        throw "dev:e2e did not become ready on :$devPort within 4 minutes. See $log"
    }
}

$env:TEST_BASE_URL = "http://localhost:4011"
Write-Host "Devnet governance E2E..." -ForegroundColor Cyan
npx playwright test e2e/governance.devnet.spec.ts --project=chromium
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { exit $code }
Write-Host "Governance devnet E2E passed." -ForegroundColor Green

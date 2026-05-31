# Wallet production closure - migrations verify, schema checks, API smoke, Go tests.
# Usage:
#   .\scripts\wallet-production-closure.ps1
#   .\scripts\wallet-production-closure.ps1 -ApplyMigrations

param(
    [string]$ApiBaseUrl = "http://localhost:18080",
    [string]$PostgresContainer = "proxyhubb-postgres",
    [string]$PostgresUser = "proxyhubb",
    [string]$PostgresDb = "proxyhubb",
    [string]$TestDatabaseUrl = "postgresql://proxyhubb:proxyhubb@127.0.0.1:5433/proxyhubb_test?sslmode=disable",
    [switch]$ApplyMigrations,
    [switch]$SkipTests,
    [switch]$SkipApi
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$requiredMigrations = @(
    "000080_withdrawal_security",
    "000081_user_flags",
    "000082_widen_explorer_numeric_columns",
    "000083_wallet_ledger_tx_hash",
    "000084_pending_tx_idempotency_fix",
    "000085_provider_registry_link",
    "000086_provider_nodes_base_price",
    "000087_listing_provider_node_link",
    "000088_remove_fiat_wallet_artifacts"
)

$script:passes = New-Object System.Collections.Generic.List[string]
$script:failures = New-Object System.Collections.Generic.List[string]

function Record-Ok([string]$msg) {
    $script:passes.Add($msg) | Out-Null
    Write-Host "[OK] $msg" -ForegroundColor Green
}

function Record-Fail([string]$msg) {
    $script:failures.Add($msg) | Out-Null
    Write-Host "[FAIL] $msg" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== Wallet production closure ===" -ForegroundColor Cyan
Write-Host "Repo: $repoRoot"
Write-Host ""

if ($ApplyMigrations) {
    Write-Host "Applying migrations (docker compose db-migrate)..." -ForegroundColor Yellow
    docker compose -f docker-compose.dev.yml up db-migrate
    if ($LASTEXITCODE -ne 0) {
        Record-Fail "db-migrate exited non-zero"
    } else {
        Record-Ok "db-migrate completed"
    }
}

$pgRunning = docker ps --format "{{.Names}}" 2>$null | Select-String -SimpleMatch $PostgresContainer
if (-not $pgRunning) {
    Record-Fail "Postgres container '$PostgresContainer' not running. Start: docker compose -f docker-compose.dev.yml up -d postgres"
} else {
    function Invoke-PsqlQuery([string]$sql) {
        docker exec $PostgresContainer psql -U $PostgresUser -d $PostgresDb -t -A -c $sql 2>&1
    }

    $applied = Invoke-PsqlQuery "SELECT version FROM schema_migrations WHERE version >= '000080' ORDER BY version;"
    foreach ($ver in $requiredMigrations) {
        if ($applied -match [regex]::Escape($ver)) {
            Record-Ok "migration applied: $ver"
        } else {
            Record-Fail "migration missing: $ver"
        }
    }

    $walletColsSql = "SELECT column_name FROM information_schema.columns WHERE table_name = 'wallets' AND column_name IN ('withdrawal_whitelist','primary_withdrawal_address','withdrawal_address_changed_at','balance_usdt');"
    $walletCols = Invoke-PsqlQuery $walletColsSql
    foreach ($col in @("withdrawal_whitelist", "primary_withdrawal_address", "withdrawal_address_changed_at")) {
        if ($walletCols -match $col) {
            Record-Ok "wallets column present: $col"
        } else {
            Record-Fail "wallets column missing: $col"
        }
    }
    if ($walletCols -match "balance_usdt") {
        Record-Fail "wallets.balance_usdt should be dropped (000088)"
    } else {
        Record-Ok "wallets.balance_usdt removed"
    }

    $flags = Invoke-PsqlQuery "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_flags');"
    if ($flags -match 't') {
        Record-Ok "user_flags table exists"
    } else {
        Record-Fail "user_flags table missing"
    }

    $txHash = Invoke-PsqlQuery "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'wallet_ledger_entries' AND column_name = 'tx_hash');"
    if ($txHash -match 't') {
        Record-Ok "wallet_ledger_entries.tx_hash present"
    } else {
        Record-Fail "wallet_ledger_entries.tx_hash missing"
    }
}

$composeFiles = @("docker-compose.dev.yml", "docker-compose.full.yml", "docker-compose.minimal.yml", "docker-compose.prod.yml")
foreach ($f in $composeFiles) {
    $path = Join-Path $repoRoot $f
    if (-not (Test-Path $path)) { continue }
    $content = Get-Content $path -Raw
    if ($content -match "PAYSTACK_|paystack") {
        Record-Fail "$f still references Paystack"
    } else {
        Record-Ok "$f has no Paystack env"
    }
}

if (-not $SkipApi) {
    $healthUri = ($ApiBaseUrl.TrimEnd('/')) + '/health'
    $treasuryUri = ($ApiBaseUrl.TrimEnd('/')) + '/v1/treasury/public'
    $solanaUri = ($ApiBaseUrl.TrimEnd('/')) + '/v1/solana/health'
    $configUri = ($ApiBaseUrl.TrimEnd('/')) + '/v1/system/config/public'

    try {
        $health = Invoke-RestMethod -Uri $healthUri -TimeoutSec 10
        if ($health.status -eq "ok") { Record-Ok 'GET /health' } else { Record-Fail "GET /health bad response" }
    } catch {
        Record-Fail ("GET /health failed: " + $_.Exception.Message)
    }

    try {
        $treasury = Invoke-RestMethod -Uri $treasuryUri -TimeoutSec 30
        if ($treasury.oracle_configured) { Record-Ok 'GET /v1/treasury/public' } else { Record-Fail 'oracle_configured is false' }
    } catch {
        Record-Fail ("GET /v1/treasury/public failed: " + $_.Exception.Message)
    }

    try {
        $sol = Invoke-RestMethod -Uri $solanaUri -TimeoutSec 15
        if ($sol.status) { Record-Ok 'GET /v1/solana/health' } else { Record-Fail 'solana health missing status' }
    } catch {
        Record-Fail ("GET /v1/solana/health failed: " + $_.Exception.Message)
    }

    try {
        $cfg = Invoke-RestMethod -Uri $configUri -TimeoutSec 10
        if ($cfg.treasury_solana) { Record-Ok 'public config treasury_solana' }
    } catch {
        Write-Host "[WARN] GET /v1/system/config/public skipped" -ForegroundColor Yellow
    }
}

if (-not $SkipTests) {
    Write-Host ""
    Write-Host "Running Go tests..." -ForegroundColor Yellow
    Push-Location (Join-Path $repoRoot "services\control-api")
    $env:TEST_DATABASE_URL = $TestDatabaseUrl
    $env:EMERGENCY_SOL_PRICE_USD = "200"

    go test ./internal/billing/... -count=1
    if ($LASTEXITCODE -eq 0) { Record-Ok "billing tests" } else { Record-Fail "billing tests" }

    go test ./internal/api/... -count=1 -run 'Wallet|Withdrawal|Whitelist|Cooldown|Crypto|GDPR|Treasury'
    if ($LASTEXITCODE -eq 0) { Record-Ok "wallet API tests" } else { Record-Fail "wallet API tests" }

    Pop-Location
}

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
Write-Host ("Passed: " + $script:passes.Count)
Write-Host ("Failed: " + $script:failures.Count)
if ($script:failures.Count -gt 0) {
    foreach ($f in $script:failures) { Write-Host ("  - " + $f) -ForegroundColor Red }
    Write-Host ""
    Write-Host "See docs/WALLET_PRODUCTION_CLOSURE.md and WALLET_E2E_SMOKE.md for manual steps." -ForegroundColor Yellow
    exit 1
}
Write-Host ""
Write-Host "Automated checks passed. Complete manual wallet smoke in WALLET_E2E_SMOKE.md" -ForegroundColor Green
exit 0

param(
    [switch]$RunIntegration,
    [string]$ArtifactDir = "testing/artifacts"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$serviceDir = Join-Path $repoRoot "services/control-api"
$artifactRoot = Join-Path $repoRoot $ArtifactDir
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$unitTestName = "TestMarkSettlementArtifactsSettledAdvancesSessionIntentLifecycle"
$integrationTestName = "TestZKAggregator_SubmitBatchDirect_PersistsProofBytesFromRealProver"
$defaultTestDatabaseUrl = "postgresql://proxyhubb:proxyhubb@127.0.0.1:5433/proxyhubb_test?sslmode=disable"

New-Item -ItemType Directory -Force -Path $artifactRoot | Out-Null

$unitArtifact = Join-Path $artifactRoot "rc03-settlement-unit-$timestamp.jsonl"
$integrationArtifact = Join-Path $artifactRoot "rc03-settlement-integration-$timestamp.jsonl"

Push-Location $serviceDir
try {
    Write-Host "Running RC-03 settlement lifecycle unit validation..."
    $previousDatabaseUrl = $env:DATABASE_URL
    $previousTestDatabaseUrl = $env:TEST_DATABASE_URL
    $seededDefaultTestDatabase = [string]::IsNullOrWhiteSpace($env:TEST_DATABASE_URL)
    if ($seededDefaultTestDatabase) {
        $env:TEST_DATABASE_URL = $defaultTestDatabaseUrl
    }

    try {
        & go test ./internal/billing -run $unitTestName -count=1 -json 2>&1 |
            Tee-Object -FilePath $unitArtifact
        if ($LASTEXITCODE -ne 0) {
            throw "Settlement lifecycle unit validation failed."
        }
    }
    finally {
        if ($null -ne $previousDatabaseUrl) {
            $env:DATABASE_URL = $previousDatabaseUrl
        }
        elseif (Test-Path Env:DATABASE_URL) {
            Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
        }

        if ($null -ne $previousTestDatabaseUrl) {
            $env:TEST_DATABASE_URL = $previousTestDatabaseUrl
        }
        elseif ($seededDefaultTestDatabase -and (Test-Path Env:TEST_DATABASE_URL)) {
            Remove-Item Env:TEST_DATABASE_URL -ErrorAction SilentlyContinue
        }
    }

    $unitEvents = Get-Content $unitArtifact | ForEach-Object { $_ | ConvertFrom-Json }
    if ($unitEvents | Where-Object { $_.Test -eq $unitTestName -and $_.Action -eq "skip" }) {
        throw "Settlement lifecycle unit validation was skipped. Start the docker-compose.test Postgres service or set TEST_DATABASE_URL explicitly."
    }

    Write-Host "Unit validation artifact: $unitArtifact"

    if (-not $RunIntegration) {
        Write-Host "Skipping integration validation. Re-run with -RunIntegration after setting DATABASE_URL and HALO2_PROVER_URL."
        return
    }

    if ([string]::IsNullOrWhiteSpace($env:DATABASE_URL)) {
        throw "DATABASE_URL must be set when -RunIntegration is requested."
    }

    if ([string]::IsNullOrWhiteSpace($env:HALO2_PROVER_URL)) {
        throw "HALO2_PROVER_URL must be set when -RunIntegration is requested."
    }

    $previousOracleKeypair = $env:SOLANA_ORACLE_KEYPAIR
    $seededDefaultOracleKeypair = $false
    if ([string]::IsNullOrWhiteSpace($env:SOLANA_ORACLE_KEYPAIR)) {
        $defaultOracleKeypair = Join-Path $repoRoot "infra/oracle-keypair.json"
        if (Test-Path $defaultOracleKeypair) {
            $env:SOLANA_ORACLE_KEYPAIR = $defaultOracleKeypair
            $seededDefaultOracleKeypair = $true
        }
    }
    if ([string]::IsNullOrWhiteSpace($env:SOLANA_ORACLE_KEYPAIR)) {
        throw "SOLANA_ORACLE_KEYPAIR must be set when -RunIntegration is requested (or provide infra/oracle-keypair.json)."
    }
    if (-not (Test-Path $env:SOLANA_ORACLE_KEYPAIR)) {
        throw "SOLANA_ORACLE_KEYPAIR points to a missing file: $($env:SOLANA_ORACLE_KEYPAIR)"
    }

    Write-Host "Running RC-03 batch proof integration validation..."
    & go test -tags=integration ./internal/billing -run $integrationTestName -count=1 -json 2>&1 |
        Tee-Object -FilePath $integrationArtifact
    if ($LASTEXITCODE -ne 0) {
        throw "Settlement integration validation failed."
    }

    $integrationEvents = Get-Content $integrationArtifact | ForEach-Object { $_ | ConvertFrom-Json }
    if ($integrationEvents | Where-Object { $_.Test -eq $integrationTestName -and $_.Action -eq "skip" }) {
        throw "Settlement integration validation was skipped. Check DATABASE_URL, HALO2_PROVER_URL, SOLANA_ORACLE_KEYPAIR, and prover health."
    }

    Write-Host "Integration validation artifact: $integrationArtifact"
}
finally {
    if ($seededDefaultOracleKeypair) {
        if ($null -ne $previousOracleKeypair) {
            $env:SOLANA_ORACLE_KEYPAIR = $previousOracleKeypair
        }
        elseif (Test-Path Env:SOLANA_ORACLE_KEYPAIR) {
            Remove-Item Env:SOLANA_ORACLE_KEYPAIR -ErrorAction SilentlyContinue
        }
    }
    Pop-Location
}
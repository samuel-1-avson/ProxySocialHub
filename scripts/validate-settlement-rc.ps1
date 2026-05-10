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
$runningOnWindows = $env:OS -eq "Windows_NT"

function Convert-HostValueForDocker {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $Value
    }

    $rewritten = $Value -replace '://localhost(?=[:/]|$)', '://host.docker.internal'
    $rewritten = $rewritten -replace '://127\.0\.0\.1(?=[:/]|$)', '://host.docker.internal'
    $rewritten = $rewritten -replace '@localhost(?=[:/]|$)', '@host.docker.internal'
    $rewritten = $rewritten -replace '@127\.0\.0\.1(?=[:/]|$)', '@host.docker.internal'
    $rewritten = $rewritten -replace 'host=localhost(?=\s|$)', 'host=host.docker.internal'
    $rewritten = $rewritten -replace 'host=127\.0\.0\.1(?=\s|$)', 'host=host.docker.internal'
    return $rewritten
}

function Invoke-GoTestInDocker {
    param(
        [string[]]$GoTestArgs,
        [string]$ArtifactPath,
        [string]$TestDatabaseUrl,
        [string]$DatabaseUrl,
        [string]$Halo2ProverUrl,
        [string]$OracleKeypairPath
    )

    $dockerArgs = @(
        'run',
        '--rm',
        '--entrypoint', '/bin/sh',
        '-v', "${repoRoot}:/workspace",
        '-w', '/workspace/services/control-api'
    )

    if (-not [string]::IsNullOrWhiteSpace($TestDatabaseUrl)) {
        $dockerArgs += @('-e', "TEST_DATABASE_URL=$(Convert-HostValueForDocker $TestDatabaseUrl)")
    }
    if (-not [string]::IsNullOrWhiteSpace($DatabaseUrl)) {
        $dockerArgs += @('-e', "DATABASE_URL=$(Convert-HostValueForDocker $DatabaseUrl)")
    }
    if (-not [string]::IsNullOrWhiteSpace($Halo2ProverUrl)) {
        $dockerArgs += @('-e', "HALO2_PROVER_URL=$(Convert-HostValueForDocker $Halo2ProverUrl)")
    }
    if (-not [string]::IsNullOrWhiteSpace($OracleKeypairPath)) {
        $dockerOracleKeypair = '/run/secrets/rc03-oracle-keypair.json'
        $dockerArgs += @('-v', "${OracleKeypairPath}:$dockerOracleKeypair:ro")
        $dockerArgs += @('-e', "SOLANA_ORACLE_KEYPAIR=$dockerOracleKeypair")
    }

    $dockerCommandParts = @('/usr/local/go/bin/go', 'test')
    foreach ($goArg in $GoTestArgs) {
        $dockerCommandParts += ('"' + ($goArg -replace '"', '\\"') + '"')
    }

    $dockerArgs += @(
        'golang:1.26-alpine',
        '-lc',
        [string]::Join(' ', $dockerCommandParts)
    )

    & docker @dockerArgs 2>&1 | Tee-Object -FilePath $ArtifactPath
    return $LASTEXITCODE
}

function Invoke-GoTestWithWindowsFallback {
    param(
        [string[]]$GoTestArgs,
        [string]$ArtifactPath,
        [string]$FailureMessage,
        [string]$TestDatabaseUrl,
        [string]$DatabaseUrl,
        [string]$Halo2ProverUrl,
        [string]$OracleKeypairPath
    )

    $hostAttemptArtifact = "$ArtifactPath.host-attempt"
    Remove-Item $hostAttemptArtifact -ErrorAction SilentlyContinue

    & go @GoTestArgs 2>&1 | Tee-Object -FilePath $hostAttemptArtifact
    $hostExitCode = $LASTEXITCODE

    if ($hostExitCode -eq 0) {
        Move-Item -Force $hostAttemptArtifact $ArtifactPath
        return
    }

    $hostOutput = if (Test-Path $hostAttemptArtifact) {
        Get-Content $hostAttemptArtifact -Raw
    }
    else {
        ""
    }

    $canRetryInDocker = $runningOnWindows -and
        $hostOutput -match '%1 is not a valid Win32 application' -and
        (Get-Command docker -ErrorAction SilentlyContinue)

    if (-not $canRetryInDocker) {
        Move-Item -Force $hostAttemptArtifact $ArtifactPath
        throw $FailureMessage
    }

    Write-Host "Host go test hit a Windows launcher failure; retrying inside golang:1.26-alpine..."
    $dockerArgs = @{
        GoTestArgs       = $GoTestArgs
        ArtifactPath     = $ArtifactPath
        TestDatabaseUrl  = $TestDatabaseUrl
        DatabaseUrl      = $DatabaseUrl
        Halo2ProverUrl   = $Halo2ProverUrl
        OracleKeypairPath = $OracleKeypairPath
    }
    $dockerExitCode = Invoke-GoTestInDocker @dockerArgs

    Remove-Item $hostAttemptArtifact -ErrorAction SilentlyContinue

    if ($dockerExitCode -ne 0) {
        throw $FailureMessage
    }
}

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
        $unitArgs = @{
            GoTestArgs        = @('test', './internal/billing', '-run', $unitTestName, '-count=1', '-json')
            ArtifactPath      = $unitArtifact
            FailureMessage    = 'Settlement lifecycle unit validation failed.'
            TestDatabaseUrl   = $env:TEST_DATABASE_URL
            DatabaseUrl       = $env:DATABASE_URL
            Halo2ProverUrl    = $null
            OracleKeypairPath = $null
        }
        Invoke-GoTestWithWindowsFallback @unitArgs
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
    $integrationArgs = @{
        GoTestArgs        = @('test', '-tags=integration', './internal/billing', '-run', $integrationTestName, '-count=1', '-json')
        ArtifactPath      = $integrationArtifact
        FailureMessage    = 'Settlement integration validation failed.'
        TestDatabaseUrl   = $env:TEST_DATABASE_URL
        DatabaseUrl       = $env:DATABASE_URL
        Halo2ProverUrl    = $env:HALO2_PROVER_URL
        OracleKeypairPath = $env:SOLANA_ORACLE_KEYPAIR
    }
    Invoke-GoTestWithWindowsFallback @integrationArgs

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
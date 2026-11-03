[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$TestDatabaseUrl,
    [Parameter(Mandatory)][string]$OutputDirectory,
    [string]$GoExecutable = 'go',
    [string]$KmsKeyA,
    [string]$KmsKeyB,
    [string]$ImpersonateServiceAccount,
    [switch]$ExerciseKmsControl
)

$ErrorActionPreference = 'Stop'
$taskDatabase = [Uri]$TestDatabaseUrl
if ($taskDatabase.Scheme -notin @('postgres','postgresql') -or
    $taskDatabase.Host -notin @('127.0.0.1','localhost','::1') -or
    $taskDatabase.AbsolutePath -notmatch '^/[a-z0-9_]*test[a-z0-9_]*$') {
    throw 'Use an isolated loopback PostgreSQL database whose name contains test. The test harness recreates package databases.'
}
if ([bool]$KmsKeyA -ne [bool]$KmsKeyB) { throw 'Provide both staging KMS resources or neither.' }
foreach ($taskKey in @($KmsKeyA,$KmsKeyB) | Where-Object { $_ }) {
    if ($taskKey -notmatch '^projects/[a-z0-9-]+/locations/[a-z0-9-]+/keyRings/proxyhubb-embedded-staging/cryptoKeys/[a-zA-Z0-9_-]+$') {
        throw 'The cloud drill permits only the dedicated proxyhubb-embedded-staging key ring.'
    }
}
if ($KmsKeyA -and $KmsKeyA -eq $KmsKeyB) { throw 'Rotation needs two different staging keys.' }
if ($ExerciseKmsControl -and (!$KmsKeyA -or !$ImpersonateServiceAccount)) {
    throw 'Key-control checks require dedicated staging keys and a separate impersonated runtime identity.'
}
if ($ImpersonateServiceAccount -and $ImpersonateServiceAccount -notmatch '^proxyhubb-custody-staging@[a-z0-9-]+\.iam\.gserviceaccount\.com$') {
    throw 'Use a dedicated proxyhubb-custody-staging service account.'
}

$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$taskOutput = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $taskOutput -Force | Out-Null
$taskVariables = @{
    GOFLAGS='-buildvcs=false'; CGO_ENABLED='0'; GOMAXPROCS='2'; GOTOOLCHAIN='local';
    APP_ENV='development'; ENVIRONMENT='development';
    TEST_DATABASE_URL=$TestDatabaseUrl;
    JWT_SECRET='isolated-staging-drill-jwt-secret-at-least-sixty-four-characters-long';
    SESSION_SECRET='isolated-staging-drill-session-secret-at-least-sixty-four-characters';
    TOKEN_HMAC_SECRET='isolated-staging-drill-hmac-secret-at-least-sixty-four-characters-long';
    ENCRYPTION_KEY='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
    EMBEDDED_WALLET_KEK_PROVIDER='local';
    EMBEDDED_WALLET_GCP_KMS_READ_KEYS='';
    CUSTODY_DRILL_KMS_KEY_A=$null; CUSTODY_DRILL_KMS_KEY_B=$null;
    CUSTODY_DRILL_ACCESS_TOKEN=$null; CUSTODY_DRILL_CONTROL_TOKEN=$null
}
$taskPrevious = @{}
foreach ($taskName in $taskVariables.Keys) {
    $taskPrevious[$taskName] = [Environment]::GetEnvironmentVariable($taskName,'Process')
    [Environment]::SetEnvironmentVariable($taskName,$taskVariables[$taskName],'Process')
}

function Invoke-DrillGo([string]$LogName,[string[]]$Arguments) {
    & $GoExecutable @Arguments > (Join-Path $taskOutput $LogName) 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Go verification failed; inspect $LogName" }
}

Push-Location (Join-Path $taskRoot 'services/control-api')
try {
    Invoke-DrillGo 'security-local.jsonl' @('test','-json','-count=1',
        './internal/custody','./internal/api','./internal/middleware',
        './internal/accountclosure','./internal/worker','./internal/ws')
    Invoke-DrillGo 'compile.log' @('test','-run','^$','./...')
    if ($KmsKeyA) {
        $env:CUSTODY_DRILL_KMS_KEY_A=$KmsKeyA
        $env:CUSTODY_DRILL_KMS_KEY_B=$KmsKeyB
        if ($ExerciseKmsControl) {
            $env:CUSTODY_DRILL_CONTROL_TOKEN = (& gcloud auth print-access-token --quiet)
            if ($LASTEXITCODE -ne 0) { throw 'Could not acquire operator credential.' }
        }
        if ($ImpersonateServiceAccount) {
            $env:CUSTODY_DRILL_ACCESS_TOKEN = (& gcloud auth print-access-token "--impersonate-service-account=$ImpersonateServiceAccount" --quiet)
            if ($LASTEXITCODE -ne 0) { throw 'Could not acquire restricted runtime credential.' }
        }
        Invoke-DrillGo 'security-live-kms.jsonl' @('test','-json','-count=1','./internal/custody','-run','^TestStagingCustodyLiveKMS$')
    }
    [ordered]@{local_security='passed';compile='passed';live_kms=$(if($KmsKeyA){'passed'}else{'not_requested'});key_control=[bool]$ExerciseKmsControl} |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskOutput 'summary.json')
    Write-Output "Drill passed. Evidence: $taskOutput"
} finally {
    Pop-Location
    foreach ($taskName in $taskPrevious.Keys) {
        [Environment]::SetEnvironmentVariable($taskName,$taskPrevious[$taskName],'Process')
    }
}

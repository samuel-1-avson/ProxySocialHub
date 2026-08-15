# Wave 12.B — permissionless join *runbook* proof (no Postgres seed).
# Does not send a bond tx. Does not claim multi_org. Not DePIN.
#
#   .\scripts\w12b-permissionless-join.cmd
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/w12b-permissionless-join.ps1
$ErrorActionPreference = "Stop"
if ($env:CONFIRM_W7D_EXTERNAL_VPS -eq "1") {
    Write-Error "FAIL: this runbook script is not the live VPS claim"
}
$Root = Split-Path -Parent $PSScriptRoot
if (-not $Root) { $Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path }
$ApiDir = Join-Path $Root "services\control-api"
$Work = if ($env:W12B_WORKDIR) { $env:W12B_WORKDIR } else { Join-Path $env:TEMP ("w12b-join-" + [guid]::NewGuid().ToString("n")) }
New-Item -ItemType Directory -Force -Path $Work | Out-Null
$utf8 = New-Object System.Text.UTF8Encoding $false
function Write-Utf8NoBom([string]$Path, [string]$Text) {
    [System.IO.File]::WriteAllText($Path, $Text, $utf8)
}
function Invoke-JoinCmd([string]$Command, [string]$StdinPath) {
    Push-Location $ApiDir
    try {
        if ($StdinPath) {
            return Get-Content -Raw -Encoding utf8 $StdinPath | & go run ./cmd/w7d-operator-join $Command
        }
        return & go run ./cmd/w7d-operator-join $Command
    } finally {
        Pop-Location
    }
}

Write-Host "=== W12.B permissionless join runbook (no Postgres) ==="
Write-Host "--- keygen ---"
$keyOut = Invoke-JoinCmd "keygen" $null
if ($LASTEXITCODE -ne 0) { throw "keygen failed" }
Write-Utf8NoBom (Join-Path $Work "key.json") $keyOut

Write-Host "--- sign distinct org_id (not platform) ---"
$joinOut = Invoke-JoinCmd "sign-from-keygen" (Join-Path $Work "key.json")
if ($LASTEXITCODE -ne 0) { throw "sign-from-keygen failed" }
Write-Utf8NoBom (Join-Path $Work "join.json") $joinOut
$bundleOut = Invoke-JoinCmd "extract-bundle" (Join-Path $Work "join.json")
if ($LASTEXITCODE -ne 0) { throw "extract-bundle failed" }
Write-Utf8NoBom (Join-Path $Work "bundle.json") $bundleOut
Write-Host "postgres_seed=false"

Write-Host "--- verify bundle (no control-api, no Postgres) ---"
Push-Location $ApiDir
try {
    & go run ./cmd/w7b-manifest-bundle verify (Join-Path $Work "bundle.json")
    if ($LASTEXITCODE -ne 0) { throw "verify failed" }
} finally {
    Pop-Location
}

Write-Host "--- bond is a separate operator tx ---"
Write-Host "CONFIRM_W12B_BOND=1 go run ./cmd/w8-gateway-bond bond"
Write-Host "W12B_BOND_SKIPPED (no operator SOL keypair in this script)"
Write-Host "W12B_JOIN_RUNBOOK_OK"
Write-Host "not multi_org; not shop merchandising; not DePIN; programs/session undeployed"

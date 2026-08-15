# Wave 12.A slice 1 — usage-challenge client proof (no on-chain accuse).
# Prefer release. Never resolve_slash. Never arm slash gates. Not DePIN.
#
#   .\scripts\w12a-usage-challenge-client.cmd
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/w12a-usage-challenge-client.ps1
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
if (-not $Root) { $Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path }
$ApiDir = Join-Path $Root "services\control-api"
$Work = if ($env:W12A_WORKDIR) { $env:W12A_WORKDIR } else { Join-Path $env:TEMP ("w12a-" + [guid]::NewGuid().ToString("n")) }
New-Item -ItemType Directory -Force -Path $Work | Out-Null
$utf8 = New-Object System.Text.UTF8Encoding $false
function Write-Utf8NoBom([string]$Path, [string]$Text) {
    [System.IO.File]::WriteAllText($Path, $Text, $utf8)
}

Write-Host "=== W12.A usage-challenge client (no accuse) ==="
Push-Location $ApiDir
try {
    go test ./internal/settlement -count=1 -run UsageChallenge
    if ($LASTEXITCODE -ne 0) { throw "usage challenge tests failed" }

    Write-Host "--- demo petition ---"
    $demo = & go run ./cmd/w12a-usage-challenge demo
    if ($LASTEXITCODE -ne 0) { throw "demo failed" }
    Write-Utf8NoBom (Join-Path $Work "petition.json") $demo

    Write-Host "--- verify ---"
    & go run ./cmd/w12a-usage-challenge verify (Join-Path $Work "petition.json")
    if ($LASTEXITCODE -ne 0) { throw "verify failed" }

    Write-Host "--- hash ---"
    & go run ./cmd/w12a-usage-challenge hash (Join-Path $Work "petition.json")
    if ($LASTEXITCODE -ne 0) { throw "hash failed" }
} finally {
    Pop-Location
}

if ($env:CONFIRM_W12A_ACCUSE -eq "1" -or $env:CONFIRM_W12A_RELEASE_SOAK -eq "1") {
    throw "FAIL: this client script is not the live accuse soak"
}
Write-Host "W12A_USAGE_CHALLENGE_CLIENT_OK"
Write-Host "not on-chain; not slash; not DePIN; programs/session undeployed"

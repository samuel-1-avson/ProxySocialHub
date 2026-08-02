param(
    [string]$Wallet = "$HOME\.config\solana\id.json",
    [string]$Cluster = "devnet",
    [double]$RequiredSol = 3.0
)

# Deploys/upgrades the session program (Config PDA + integer payout math) to
# Solana $Cluster at 8TP21JyrghboxZqXMozx2sVzrDrNSZyN2hkf1D7dQGmb.
#
# Prereqs:
#   - anchor build -p session has produced target/deploy/session.so
#   - $Wallet is the upgrade authority (oracle on testnet: 8P4uuapg...)

$ErrorActionPreference = "Stop"
Remove-Item Env:CARGO_TARGET_DIR -ErrorAction SilentlyContinue

$workspace = (Resolve-Path $PSScriptRoot).ProviderPath
$env:CARGO_TARGET_DIR = Join-Path $workspace "target"
$programKeypair = Join-Path $workspace "target\deploy\session-keypair.json"
$programSo = Join-Path $workspace "target\deploy\session.so"
$expectedProgramId = "8TP21JyrghboxZqXMozx2sVzrDrNSZyN2hkf1D7dQGmb"

Write-Host "== Preflight =="
$onChainId = (& solana-keygen pubkey $programKeypair) | Select-Object -Last 1
$onChainId = "$onChainId".Trim()
if ($onChainId -ne $expectedProgramId) { throw "Program keypair pubkey $onChainId != expected $expectedProgramId" }
Write-Host "Program keypair -> $onChainId"
Write-Host "Artifact SHA256: $((Get-FileHash $programSo -Algorithm SHA256).Hash)"

$balanceOut = (& solana balance --url $Cluster --keypair $Wallet) | Select-Object -Last 1
$balance = [double](("$balanceOut" -replace '[^\d\.]', ''))
Write-Host "Deploy wallet balance: $balance SOL ($Cluster)"
if ($balance -lt $RequiredSol) {
    throw "Insufficient funds ($balance SOL). Need ~$RequiredSol SOL for buffer rent. Fund $Wallet and re-run."
}

Write-Host "== Deploy =="
Push-Location $workspace
try {
    & solana program deploy --url $Cluster --keypair $Wallet --program-id $programKeypair $programSo
    if ($LASTEXITCODE -ne 0) { throw "program deploy failed (exit $LASTEXITCODE)" }
} finally {
    Pop-Location
}

Write-Host "== Verify =="
& solana program show $expectedProgramId --url $Cluster

Write-Host ""
Write-Host "Deploy complete."
Write-Host "  SOLANA_SESSION_PROGRAM_ID=$expectedProgramId"
Write-Host "  Next: initialize Config PDA (oracle/admin/treasury) before create_session."

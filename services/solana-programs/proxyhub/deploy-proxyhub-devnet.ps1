param(
    [string]$Wallet = "$HOME\.config\solana\id.json",
    [string]$Cluster = "devnet",
    [double]$RequiredSol = 7.0
)

# Deploys the patched proxyhub program (escrow/jury payout binding, BC-01/02)
# to devnet as a FRESH program at AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu.
#
# Prereqs:
#   - anchor build has produced target/deploy/proxyhub.so (audit 2026-07-30
#     build, SHA256 232b8e329c3ff57bd7ae5420e65c3e058f719db3d0cbfafefbbe2e8796338a69)
#   - $Wallet is the deploy payer AND becomes the upgrade authority.
#
# What it does: funds the wallet via airdrops if needed, deploys, verifies
# on-chain state, prints post-deploy steps.

$ErrorActionPreference = "Stop"
$workspace = (Resolve-Path $PSScriptRoot).ProviderPath
$programKeypair = Join-Path $workspace "target\deploy\proxyhub-keypair.json"
$programSo = Join-Path $workspace "target\deploy\proxyhub.so"
$expectedProgramId = "AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu"

Write-Host "== Preflight =="
$onChainId = (& solana-keygen pubkey $programKeypair) | Select-Object -Last 1
$onChainId = "$onChainId".Trim()
if ($onChainId -ne $expectedProgramId) { throw "Program keypair pubkey $onChainId != expected $expectedProgramId" }
Write-Host "Program keypair -> $onChainId"

$balanceOut = (& solana balance --url $Cluster --keypair $Wallet) | Select-Object -Last 1
$balance = [double](("$balanceOut" -replace '[^\d\.]', ''))
Write-Host "Deploy wallet balance: $balance SOL ($Cluster)"

$attempts = 0
while ($balance -lt $RequiredSol -and $attempts -lt 6) {
    $attempts++
    Write-Host "Airdrop attempt $attempts (need $RequiredSol SOL)..."
    try { & solana airdrop 2 --url $Cluster --keypair $Wallet | Out-Host } catch { Write-Host "airdrop failed: $_" }
    Start-Sleep -Seconds 20
    $balanceOut = (& solana balance --url $Cluster --keypair $Wallet) | Select-Object -Last 1
    $balance = [double](("$balanceOut" -replace '[^\d\.]', ''))
    Write-Host "Balance now: $balance SOL"
}
if ($balance -lt $RequiredSol) {
    throw "Insufficient funds ($balance SOL). Fund $Wallet on devnet (e.g. https://faucet.solana.com) and re-run."
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
Write-Host "Deploy complete. Post-deploy checklist:"
Write-Host "  1. Confirm 'Authority' above is your intended upgrade authority (currently the deploy wallet)."
Write-Host "     To move it: solana program set-upgrade-authority $expectedProgramId --url $Cluster --keypair $Wallet --new-upgrade-authority <SECURE_KEYPAIR>"
Write-Host "  2. Point environments at the new program (defaults in repo are already updated):"
Write-Host "       SOLANA_PROGRAM_ID=$expectedProgramId"
Write-Host "       NEXT_PUBLIC_SOLANA_PROGRAM_ID=$expectedProgramId"
Write-Host "  3. Re-run the control-api escrow settle path on devnet (create order -> escrow init -> release)"
Write-Host "     to confirm the Go oracle accounts still match the patched constraints."
Write-Host "  4. Record the deployed bytecode hash in docs/audit/22_FINAL_VERIFICATION_REPORT.md:"
Write-Host "       solana program dump $expectedProgramId --url $Cluster -o dumped.so; certutil -hashfile dumped.so SHA256"
Write-Host "       (compare with build artifact 232b8e329c3ff57bd7ae5420e65c3e058f719db3d0cbfafefbbe2e8796338a69)"
Write-Host "  5. Session program live on devnet: 8TP21JyrghboxZqXMozx2sVzrDrNSZyN2hkf1D7dQGmb (see deploy-session-devnet.ps1)."

param(
    [string]$Wallet = "$HOME\.config\solana\id.json",
    [string]$Cluster = "devnet",
    [double]$RequiredSol = 10.0,
    [string]$ProgramSo = "",
    [switch]$Yes
)

# Upgrades the proxyhub program in place on devnet
# (AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu). This is an upgrade of the
# existing upgradeable program, not a fresh deploy: program state, PDAs and
# the program id are preserved.
#
# Prereqs (see docs/audits/P1-SC-6_IDL_CALLSITES.md for the full checklist):
#   - anchor build has produced target/deploy/proxyhub.so from a clean main
#     checkout. Record its SHA-256 before running this; the verify step
#     re-hashes the deployed binary and compares.
#   - $Wallet's pubkey IS the current upgrade authority
#     (6thzwmrfijDA5eukKzMAbQnL86RqdxiLx2maM94bRJcR when this was written).
#     The preflight below reads the authority from chain and aborts if the
#     wallet does not match, before any SOL is spent.
#   - $Wallet holds at least $RequiredSol SOL. The upgrade buffer for a
#     ~1.3 MB binary needs roughly 9 SOL of rent while it exists; buffer
#     rent is reclaimed when the buffer is consumed by the deploy.
#   - The matching control-api build is already deployed (deploy order:
#     control-api first, program second).
#
# The session program (8TP21JyrghboxZqXMozx2sVzrDrNSZyN2hkf1D7dQGmb) is not
# touched by the hardening upgrade and is not redeployed here.

$ErrorActionPreference = "Stop"
$workspace = (Resolve-Path $PSScriptRoot).ProviderPath
if (-not $ProgramSo) { $ProgramSo = Join-Path $workspace "target\deploy\proxyhub.so" }
$expectedProgramId = "AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu"

Write-Host "== Preflight =="
if (-not (Test-Path $ProgramSo)) { throw "Built program not found: $ProgramSo (run anchor build first)" }
$soHash = (Get-FileHash $ProgramSo -Algorithm SHA256).Hash.ToLower()
$soSize = (Get-Item $ProgramSo).Length
Write-Host "Program binary: $ProgramSo"
Write-Host "  size: $soSize bytes"
Write-Host "  sha256: $soHash"

$walletPubkey = ((& solana-keygen pubkey $Wallet) | Select-Object -Last 1).Trim()
Write-Host "Wallet pubkey: $walletPubkey"

$showJson = (& solana program show $expectedProgramId --url $Cluster --output json) | Out-String
$show = $showJson | ConvertFrom-Json
$authority = "$($show.authority)".Trim()
Write-Host "On-chain upgrade authority: $authority (last deploy slot $($show.lastDeploySlot), data length $($show.dataLen))"
if ($authority -ne $walletPubkey) {
    throw "Wallet $walletPubkey is not the upgrade authority ($authority). Aborting before spending anything."
}

# The upgrade fails if the new binary does not fit in the program data account, and by then
# the buffer has been paid for. Check first, and print the exact command that fixes it.
$headroom = 10240
if ($null -ne $show.dataLen -and [int64]$show.dataLen -lt $soSize) {
    $extendBy = $soSize + $headroom - [int64]$show.dataLen
    throw ("Program data account holds $($show.dataLen) bytes but the build is $soSize. Extend it first (about 1 SOL of rent), then re-run:`n" +
           "  solana program extend $expectedProgramId $extendBy --url $Cluster --keypair $Wallet")
}

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

if (-not $Yes) {
    $answer = Read-Host "Upgrade $expectedProgramId on $Cluster with sha256 $soHash ? Type UPGRADE to continue"
    if ($answer -ne "UPGRADE") { throw "Aborted by operator." }
}

Write-Host "== Write buffer =="
$bufferOut = (& solana program write-buffer $ProgramSo --url $Cluster --keypair $Wallet) | Out-String
Write-Host $bufferOut
if ($bufferOut -match "Buffer:\s+([1-9A-HJ-NP-Za-km-z]{32,44})") {
    $bufferPubkey = $Matches[1]
} else {
    throw "Could not parse buffer pubkey from write-buffer output. Find it with: solana program show --buffers --url $Cluster --keypair $Wallet -- then deploy manually with solana program deploy --buffer <BUFFER> --program-id $expectedProgramId."
}
Write-Host "Buffer: $bufferPubkey"

Write-Host "== Deploy (upgrade in place) =="
& solana program deploy --buffer $bufferPubkey --program-id $expectedProgramId --url $Cluster --keypair $Wallet | Out-Host
if ($LASTEXITCODE -ne 0) { throw "program deploy failed (exit $LASTEXITCODE). Buffer $bufferPubkey may still exist; inspect with solana program show --buffers." }

Write-Host "== Verify =="
& solana program show $expectedProgramId --url $Cluster
$dumpPath = Join-Path $workspace "target\deploy\dumped-proxyhub.so"
& solana program dump $expectedProgramId $dumpPath --url $Cluster | Out-Host
# The program data account is usually larger than the binary (it was extended, or deployed
# with --max-len) and `solana program dump` writes the whole area, zero padding included. So
# hash the first $soSize bytes and require everything after them to be zero, instead of
# hashing the whole dump (which would never equal the .so hash and would fail a good upgrade).
$dumped = [System.IO.File]::ReadAllBytes($dumpPath)
if ($dumped.Length -lt $soSize) {
    throw "Dumped program is $($dumped.Length) bytes, shorter than the built binary ($soSize). Investigate before proceeding."
}
$prefix = New-Object byte[] $soSize
[Array]::Copy($dumped, $prefix, $soSize)
$sha = [System.Security.Cryptography.SHA256]::Create()
$dumpHash = ([BitConverter]::ToString($sha.ComputeHash($prefix)) -replace '-', '').ToLower()
$tailNonZero = $false
for ($i = $soSize; $i -lt $dumped.Length; $i++) {
    if ($dumped[$i] -ne 0) { $tailNonZero = $true; break }
}
Write-Host "Deployed sha256 (first $soSize bytes of $($dumped.Length)): $dumpHash"
if ($dumpHash -ne $soHash) {
    throw "Deployed binary hash $dumpHash does not match built binary $soHash. Investigate before proceeding."
}
if ($tailNonZero) {
    throw "Hash matches, but bytes after offset $soSize in the program data account are not all zero. Investigate before proceeding."
}
Write-Host "Deployed binary matches the built artifact (padding after it is zeros)."

Write-Host ""
Write-Host "Upgrade complete. Remaining checklist (docs/audits/P1-SC-6_IDL_CALLSITES.md):"
Write-Host "  1. Publish the on-chain IDL. None exists yet on devnet, so:"
Write-Host "       anchor idl init --provider.cluster $Cluster --provider.wallet $Wallet AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu"
Write-Host "     (run from services/solana-programs/proxyhub; use 'anchor idl upgrade' instead if an IDL account now exists."
Write-Host "     Then flush control-api's Redis key anchor:idl:$expectedProgramId or wait out its 24h TTL.)"
Write-Host "  2. Re-run the control-api escrow settle path on devnet (create order -> escrow init -> release),"
Write-Host "     plus stake/unstake, proposal, review and dispute smoke tests."
Write-Host "  3. Negative smoke: from a throwaway keypair, confirm update_program_config and stake_provider are rejected."
Write-Host "  4. Record deployed sha256 $soHash and the upgrade slot in docs/audits/P1-SC-6_IDL_CALLSITES.md."
Write-Host "  5. Session program stays as-is: 8TP21JyrghboxZqXMozx2sVzrDrNSZyN2hkf1D7dQGmb."

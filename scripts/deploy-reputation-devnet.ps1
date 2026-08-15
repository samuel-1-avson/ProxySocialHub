param(
    [string]$Wallet = "$HOME\.config\solana\id.json",
    [string]$Cluster = "devnet",
    [double]$RequiredSol = 5.0
)

# Deploys / upgrades proxy_reputation on Solana at
# EnVE6ehKA2dYi69B3Lo8wt2wyDgzLw4tdtSEKoMYe5bF (Wave 4.2 / BC-11-C).
#
# Builds with Cargo feature onchain-groth16 so verify_usage requires ZKBatchPDA.
#
# Prereqs:
#   - programs/reputation/target/deploy/proxy_reputation-keypair.json
#   - Wallet funded on $Cluster

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).ProviderPath
$workspace = Join-Path $repo "programs\reputation"
$programKeypair = Join-Path $workspace "target\deploy\proxy_reputation-keypair.json"
$programSo = Join-Path $workspace "target\deploy\proxy_reputation.so"
$expectedProgramId = "EnVE6ehKA2dYi69B3Lo8wt2wyDgzLw4tdtSEKoMYe5bF"

Write-Host "== Preflight =="
if (-not (Test-Path $programKeypair)) { throw "Missing keypair: $programKeypair" }

Write-Host "Building with --features onchain-groth16 (ZKBatchPDA gate)..."
Push-Location $workspace
try {
    $env:CARGO_TARGET_DIR = Join-Path $workspace "target"
    & cargo build-sbf -- --features onchain-groth16
    if ($LASTEXITCODE -ne 0) { throw "cargo build-sbf --features onchain-groth16 failed" }
}
finally {
    Pop-Location
}
if (-not (Test-Path $programSo)) { throw "Missing program .so after build: $programSo" }
Write-Host "Built: $programSo"

$onChainId = (& solana-keygen pubkey $programKeypair) | Select-Object -Last 1
$onChainId = "$onChainId".Trim()
if ($onChainId -ne $expectedProgramId) {
    throw "Program keypair pubkey $onChainId != expected $expectedProgramId"
}
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
    throw "Insufficient funds ($balance SOL). Fund $Wallet on $Cluster and re-run."
}

Write-Host "== Deploy / upgrade =="
& solana program deploy --url $Cluster --keypair $Wallet --program-id $programKeypair $programSo
if ($LASTEXITCODE -ne 0) { throw "program deploy failed (exit $LASTEXITCODE)" }

Write-Host "== Verify =="
& solana program show $expectedProgramId --url $Cluster

Write-Host ""
Write-Host "Deploy complete. Post-deploy:"
Write-Host "  1. Set REPUTATION_PROGRAM_ID=$expectedProgramId on control-api / edge"
Write-Host "  2. initialize_config(oracle) then set_deploy_allowed(true) as admin (if first deploy)"
Write-Host "  3. Control-api credits via VerifyUsage + ZKBatchPDA after Groth16 settle"
Write-Host "  4. PROXYHUB_PROVIDER_REGISTRY_GATE=enforce on gcp-testnet"
Write-Host "  5. Evidence: docs/ops/evidence/W4_2_reputation_consume_registry_enforce_20260811.md"

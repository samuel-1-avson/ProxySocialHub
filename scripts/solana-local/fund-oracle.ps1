# Airdrops SOL on the LOCAL validator to platform payout + treasury addresses.
# Requires validator running (start-validator.ps1 or start-validator-background.ps1).

param(
    [double]$OracleSOL = 100,
    [double]$TreasurySOL = 50
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\_solana-path.ps1"
Use-SolanaPath
Ensure-SolanaConfig

$solana = Get-SolanaExe "solana"
& $solana config set --url http://127.0.0.1:8899 | Out-Null

# Defaults match docs/DEV_SOLANA_SMOKE.md (override via .env if set)
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
. (Join-Path $repoRoot "scripts\_env.ps1")
Import-RepoDotEnv -RepoRoot $repoRoot

$oracle = if ($env:SOLANA_ORACLE_PUBKEY) { $env:SOLANA_ORACLE_PUBKEY } else { "8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2" }
$treasury = if ($env:SOLANA_TREASURY_ADDRESS) { $env:SOLANA_TREASURY_ADDRESS } else { "8g7WUuPosAg82Uu7iGYCx6HBnoTBFb4QuyiJCEGzktU4" }

function Invoke-LocalAirdrop {
    param([string]$Address, [double]$AmountSOL)
    Write-Host "Airdrop $AmountSOL SOL -> $Address"
    & $solana airdrop $AmountSOL $Address --url http://127.0.0.1:8899
    $bal = & $solana balance $Address --url http://127.0.0.1:8899
    Write-Host "  Balance: $bal"
}

Write-Host "Funding wallets on local validator..."
Invoke-LocalAirdrop -Address $oracle -AmountSOL $OracleSOL
if ($treasury -and $treasury -ne $oracle) {
    Invoke-LocalAirdrop -Address $treasury -AmountSOL $TreasurySOL
}

Write-Host ""
Write-Host "Done. Point Docker at local RPC (see scripts/solana-local/README.md), restart control-api + web, then retry withdraw."

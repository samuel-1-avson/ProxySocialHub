# Interactive wallet manual E2E helper (dev/staging).
# Runs public API checks and prints authenticated curl/UI steps.
#
# Usage:
#   .\scripts\wallet-manual-e2e.ps1
#   .\scripts\wallet-manual-e2e.ps1 -ApiBaseUrl https://staging-api.example.com -AccessToken $env:ACCESS_TOKEN

param(
    [string]$ApiBaseUrl = "http://localhost:18080",
    [string]$WebBaseUrl = "http://localhost:3000",
    [string]$AccessToken = ""
)

$base = $ApiBaseUrl.TrimEnd('/')
$script:publicFailed = $false

function Write-Step([string]$id, [string]$title, [string]$detail) {
    Write-Host ""
    Write-Host "[$id] $title" -ForegroundColor Cyan
    if ($detail) { Write-Host $detail }
}

Write-Host "Wallet manual E2E - ProxyHubb" -ForegroundColor Green
Write-Host "API: $base"
Write-Host "Web: $WebBaseUrl"
Write-Host ""

# --- Public (automated) ---
Write-Step "P1" "Health" ""
try {
    $h = Invoke-RestMethod "$base/health" -TimeoutSec 10
    Write-Host "  status: $($h.status)" -ForegroundColor Green
} catch {
    Write-Host "  FAILED: $($_.Exception.Message)" -ForegroundColor Red
    $script:publicFailed = $true
}

Write-Step "P2" "Treasury public" ""
try {
    $t = Invoke-RestMethod "$base/v1/treasury/public" -TimeoutSec 30
    Write-Host "  oracle_configured: $($t.oracle_configured)"
    Write-Host "  treasury: $($t.treasury.address)"
    Write-Host "  UI: $WebBaseUrl/treasury"
} catch {
    Write-Host "  FAILED: $($_.Exception.Message)" -ForegroundColor Red
    $script:publicFailed = $true
}

Write-Step "P3" "Solana health" ""
try {
    $s = Invoke-RestMethod "$base/v1/solana/health" -TimeoutSec 15
    Write-Host "  network: $($s.network)  status: $($s.status)"
    if ($s.oracle_pubkey) { Write-Host "  oracle: $($s.oracle_pubkey)" }
} catch {
    Write-Host "  FAILED: $($_.Exception.Message)" -ForegroundColor Red
    $script:publicFailed = $true
}

# --- Authenticated (optional token) ---
$authHeader = @{}
if ($AccessToken) {
    $authHeader = @{ Authorization = "Bearer $AccessToken" }
    Write-Host ""
    Write-Host "Using provided ACCESS_TOKEN for authenticated steps." -ForegroundColor Yellow

    Write-Step "A1" "Withdrawal security GET" ""
    try {
        $sec = Invoke-RestMethod "$base/v1/wallet/withdrawal-security" -Headers $authHeader -TimeoutSec 15
        $sec | ConvertTo-Json -Depth 4
    } catch {
        Write-Host "  FAILED: $($_.Exception.Message)" -ForegroundColor Red
    }

    Write-Step "A2" "Wallet balance GET" ""
    try {
        $w = Invoke-RestMethod "$base/v1/wallet" -Headers $authHeader -TimeoutSec 15
        Write-Host "  balance_sol: $($w.balance_sol)"
    } catch {
        Write-Host "  FAILED: $($_.Exception.Message)" -ForegroundColor Red
    }
} else {
    Write-Host ""
    Write-Host "--- Authenticated steps (do in browser or pass -AccessToken) ---" -ForegroundColor Yellow
}

Write-Step "M1" "Link Solana wallet" "Dashboard -> Financial HQ -> Linked Wallets -> connect Phantom (devnet)"
Write-Step "M2" "Deposit" "Deposit SOL to treasury; UI submits POST /v1/wallet/deposit/crypto with tx signature"
Write-Step "M3" "Small withdraw" "POST /v1/wallet/withdraw/sol body: { `"amount`": 0.5 } (under signature threshold)"
Write-Step "M4" "Large withdraw" "Amount > 10 SOL: sign message withdraw:<nonce>:<amount> then retry with signature fields"
Write-Step "M5" "Whitelist" "PUT /v1/wallet/withdrawal-security/whitelist with primary linked address"
Write-Step "M6" "Provider claim (optional)" "ProviderClaimPanel or POST /v1/provider/claim/*"

if (-not $AccessToken) {
    Write-Host ""
    Write-Host "Example with token after login:" -ForegroundColor DarkGray
    Write-Host '  $token = "<jwt from browser devtools>"'
    Write-Host '  .\scripts\wallet-manual-e2e.ps1 -AccessToken $token'
    Write-Host ""
    Write-Host "Full checklist: docs/WALLET_E2E_SMOKE.md and docs/DEV_SOLANA_SMOKE.md"
}

if ($script:publicFailed) { exit 1 }
exit 0

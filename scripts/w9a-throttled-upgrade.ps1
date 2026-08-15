# Wave 9.A — throttled public-RPC write-buffer, then proxyhub upgrade (devnet).
# Never programs/session. Never mainnet. Upgrade authority stays on the laptop.
#
#   $env:CONFIRM_W9A_UPGRADE = "1"
#   powershell -File scripts/w9a-throttled-upgrade.ps1

param(
    [string]$ProgramId = "AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu",
    [double]$LoanSol = 2.0
)

$ErrorActionPreference = "Continue"
$SessionId = "8TP21JyrghboxZqXMozx2sVzrDrNSZyN2hkf1D7dQGmb"
$ExpectedAuth = "6thzwmrfijDA5eukKzMAbQnL86RqdxiLx2maM94bRJcR"
$ExpectedSha = "4DC0D0A5ACD3CAFE824D81AFE8D3F672D276AF39FE346E750A4BCAC9B673925B"
$PublicRpc = "https://api.devnet.solana.com"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$SoPath = Join-Path $Root "services\solana-programs\proxyhub\target\deploy\proxyhub.so"
$UpgradeKp = Join-Path $Root "infra\secrets\upgrade-authority-keypair.json"
$OracleKp = Join-Path $Root "infra\oracle-keypair.json"
$TreasuryKp = Join-Path $Root "treasury-keypair.json"
$WriterDir = Join-Path $PSScriptRoot "w9a-throttled-writer"
$BufferKp = Join-Path $env:TEMP "w9a-listing-commitment-buffer.json"

function Mask-Text([string]$s) {
    if ([string]::IsNullOrEmpty($s)) { return $s }
    $s = $s -replace 'api[-_]?key=([^&\s"''\\]+)', 'api-key=***'
    return $s
}

function Invoke-SolanaMasked {
    param([string[]]$CliArgs)
    $raw = & solana @CliArgs 2>&1
    $code = $LASTEXITCODE
    $out = $raw | ForEach-Object { Mask-Text "$_" }
    $out | ForEach-Object { Write-Host $_ }
    return @{ Code = $code; Out = ($out -join "`n") }
}

function Get-SolBalance([string]$kp, [string]$url) {
    $raw = & solana balance --url $url --keypair $kp 2>&1 | Out-String
    if ($raw -match '([\d.]+)\s*SOL') { return [double]$Matches[1] }
    throw ("balance_parse_fail " + (Mask-Text $raw))
}

Write-Host "=== W9.A throttled write-buffer + upgrade (devnet public RPC) ==="
if ($ProgramId -eq $SessionId) { Write-Host "REFUSE: programs/session"; exit 2 }
if ($env:CONFIRM_W9A_UPGRADE -ne "1") { Write-Host "REFUSE: set CONFIRM_W9A_UPGRADE=1"; exit 2 }
if ($env:SOLANA_CLUSTER -in @("mainnet", "mainnet-beta")) { Write-Host "REFUSE: never mainnet"; exit 2 }

test-path $SoPath | Out-Null
if (-not (Test-Path $SoPath)) { throw "missing .so" }
if (-not (Test-Path $UpgradeKp)) { throw "missing upgrade authority" }
if (-not (Test-Path $OracleKp)) { throw "missing oracle" }
if (-not (Test-Path $TreasuryKp)) { throw "missing treasury" }

$soBytes = [System.IO.File]::ReadAllBytes($SoPath)
$soText = [System.Text.Encoding]::ASCII.GetString($soBytes)
$sha = (Get-FileHash $SoPath -Algorithm SHA256).Hash.ToUpperInvariant()
Write-Host "so_size=$($soBytes.Length) sha256=$sha"
if ($sha -ne $ExpectedSha) { throw "sha mismatch" }
if (-not $soText.Contains("Listing commitment registered")) { throw "missing ListingCommitment marker" }
if (-not $soText.Contains("Groth16")) { throw "missing Groth16 marker" }

$auth = (solana-keygen pubkey $UpgradeKp).Trim()
$oraclePk = (solana-keygen pubkey $OracleKp).Trim()
$treasuryPk = (solana-keygen pubkey $TreasuryKp).Trim()
Write-Host "upgrade_authority=$auth oracle=$oraclePk treasury=$treasuryPk"
if ($auth -ne $ExpectedAuth) { throw "upgrade authority mismatch" }

Write-Host "=== program show ==="
Invoke-SolanaMasked -CliArgs @("program", "show", $ProgramId, "--url", $PublicRpc) | Out-Null

$oracleBal = Get-SolBalance $OracleKp $PublicRpc
$treasuryBal = Get-SolBalance $TreasuryKp $PublicRpc
Write-Host "oracle_sol=$oracleBal treasury_sol=$treasuryBal"

$loaned = 0.0
$writeOk = $false
$upgradeOk = $false
try {
    if ($oracleBal -lt 8.5) {
        if ($treasuryBal -lt ($LoanSol + 0.05)) { throw "treasury too low for loan" }
        Write-Host "=== treasury loan $LoanSol SOL -> oracle ==="
        $loanTx = Invoke-SolanaMasked -CliArgs @(
            "transfer", $oraclePk, "$LoanSol",
            "--url", $PublicRpc, "--keypair", $TreasuryKp,
            "--allow-unfunded-recipient"
        )
        if ($loanTx.Code -ne 0) { throw "treasury loan failed" }
        $loaned = $LoanSol
        Start-Sleep 3
        Write-Host ("oracle_sol_after_loan=" + (Get-SolBalance $OracleKp $PublicRpc))
    }

    if (-not (Test-Path (Join-Path $WriterDir "node_modules\@solana\web3.js"))) {
        Write-Host "=== npm install @solana/web3.js (local writer) ==="
        Push-Location $WriterDir
        npm install --omit=dev --no-fund --no-audit
        Pop-Location
    }

    Write-Host "=== throttled write-buffer ==="
    Push-Location $WriterDir
    node .\write-buffer.mjs --rpc $PublicRpc --so $SoPath --payer $OracleKp --buffer-kp $BufferKp --program-id $ProgramId
    $nodeCode = $LASTEXITCODE
    Pop-Location
    if ($nodeCode -ne 0) { throw "throttled write-buffer failed" }
    $writeOk = $true

    $bufferPk = $null
    if (Test-Path $BufferKp) {
        $bufferPk = (solana-keygen pubkey $BufferKp).Trim()
    }
    Write-Host "buffer_pubkey=$bufferPk"

    Write-Host "=== set buffer authority to upgrade key ==="
    $setAuth = Invoke-SolanaMasked -CliArgs @(
        "program", "set-buffer-authority", $bufferPk,
        "--new-buffer-authority", $auth,
        "--url", $PublicRpc,
        "--keypair", $OracleKp
    )
    if ($setAuth.Code -ne 0) { throw "set-buffer-authority failed" }

    Write-Host "=== deploy buffer -> program ==="
    $up = Invoke-SolanaMasked -CliArgs @(
        "program", "deploy",
        "--url", $PublicRpc,
        "--keypair", $OracleKp,
        "--program-id", $ProgramId,
        "--upgrade-authority", $UpgradeKp,
        "--buffer", $bufferPk,
        "--use-rpc",
        "--max-sign-attempts", "8"
    )
    if ($up.Code -ne 0) { throw "upgrade_from_buffer_failed" }

    $dump = Join-Path $env:TEMP "proxyhub-w9a-live.dump.so"
    if (Test-Path $dump) { Remove-Item $dump -Force }
    Write-Host "=== dump ELF markers ==="
    Invoke-SolanaMasked -CliArgs @("program", "dump", $ProgramId, $dump, "--url", $PublicRpc) | Out-Null
    if (-not (Test-Path $dump)) { throw "dump missing" }
    $dBytes = [System.IO.File]::ReadAllBytes($dump)
    $dText = [System.Text.Encoding]::ASCII.GetString($dBytes)
    $dSha = (Get-FileHash $dump -Algorithm SHA256).Hash.ToUpperInvariant()
    $hasListing = $dText.Contains("Listing commitment registered")
    $hasGroth = $dText.Contains("Groth16")
    Write-Host "dump_size=$($dBytes.Length) dump_sha256=$dSha dump_listing=$hasListing dump_groth16=$hasGroth"
    if (-not $hasListing -or -not $hasGroth) {
        throw "dump markers missing listing=$hasListing groth16=$hasGroth"
    }
    $upgradeOk = $true
    Write-Host "W9A_PROXYHUB_UPGRADE_DONE"
    Write-Host "gcp PROXYHUB_LISTING_COMMITMENT stays off until observe soak; not a catalog; not DePIN"
}
catch {
    Write-Host ("FAIL " + (Mask-Text $_.Exception.Message))
}
finally {
    if (-not $writeOk) {
        Write-Host "=== close leftover buffers (write did not finish) ==="
        $show = & solana program show --buffers --url $PublicRpc --keypair $OracleKp 2>&1
        $show | ForEach-Object { Write-Host (Mask-Text "$_") }
        foreach ($line in $show) {
            if ("$line" -match '^([1-9A-HJ-NP-Za-km-z]{32,44})\s') {
                Invoke-SolanaMasked -CliArgs @(
                    "program", "close", $Matches[1],
                    "--url", $PublicRpc, "--keypair", $OracleKp, "--recipient", $oraclePk
                ) | Out-Null
            }
        }
    }
    elseif (-not $upgradeOk) {
        Write-Host "KEEP_BUFFER write ok, upgrade not confirmed - do not close"
    }
    $cur = Get-SolBalance $OracleKp $PublicRpc
    if ($loaned -gt 0 -and $cur -ge 9.0) {
        $repay = [Math]::Min($loaned, [Math]::Floor(($cur - 7.90) * 1000) / 1000)
        if ($repay -ge 0.05) {
            Write-Host "=== repay $repay SOL oracle -> treasury ==="
            Invoke-SolanaMasked -CliArgs @(
                "transfer", $treasuryPk, "$repay",
                "--url", $PublicRpc, "--keypair", $OracleKp
            ) | Out-Null
        }
    } else {
        Write-Host ("repay_skip oracle_sol=" + $cur + " loaned=" + $loaned + " writeOk=" + $writeOk + " upgradeOk=" + $upgradeOk)
    }
    $finalOracle = Get-SolBalance $OracleKp $PublicRpc
    $finalTreasury = Get-SolBalance $TreasuryKp $PublicRpc
    Write-Host ("final oracle_sol=" + $finalOracle + " treasury_sol=" + $finalTreasury)
}

if (-not $upgradeOk) { exit 1 }

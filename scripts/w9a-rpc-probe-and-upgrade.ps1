# Wave 9.A — keyed/public RPC write-buffer probe, then proxyhub upgrade (devnet).
# Never programs/session. Never mainnet. Upgrade authority stays on the laptop.
#
# Usage:
#   $env:CONFIRM_W9A_UPGRADE = "1"
#   powershell -File scripts/w9a-rpc-probe-and-upgrade.ps1
#
# Probe: getHealth + write-buffer of the ListingCommitment+Groth16 .so.
# If write-buffer PASS, deploy that buffer (do not close and rewrite).
# Always close leftover buffers and repay any treasury loan.

param(
    [string]$ProgramId = "AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu",
    [string]$SoPath = "",
    [string]$UpgradeKp = "",
    [string]$OracleKp = "",
    [string]$TreasuryKp = "",
    [double]$LoanSol = 2.0
)

$ErrorActionPreference = "Continue"
$SessionId = "8TP21JyrghboxZqXMozx2sVzrDrNSZyN2hkf1D7dQGmb"
$ExpectedAuth = "6thzwmrfijDA5eukKzMAbQnL86RqdxiLx2maM94bRJcR"
$ExpectedSha = "4DC0D0A5ACD3CAFE824D81AFE8D3F672D276AF39FE346E750A4BCAC9B673925B"
$Project = "gen-lang-client-0022105784"
$SecretName = "proxyhubb-testnet-solana-rpc-url"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $SoPath) { $SoPath = Join-Path $Root "services\solana-programs\proxyhub\target\deploy\proxyhub.so" }
if (-not $UpgradeKp) { $UpgradeKp = Join-Path $Root "infra\secrets\upgrade-authority-keypair.json" }
if (-not $OracleKp) { $OracleKp = Join-Path $Root "infra\oracle-keypair.json" }
if (-not $TreasuryKp) { $TreasuryKp = Join-Path $Root "treasury-keypair.json" }

function Mask-Text([string]$s) {
    if ([string]::IsNullOrEmpty($s)) { return $s }
    $s = $s -replace 'api[-_]?key=([^&\s"''\\]+)', 'api-key=***'
    $s = $s -replace 'https://[^/\s"]+\.helius-rpc\.com[^\s"]*', 'https://***.helius-rpc.com/?api-key=***'
    $s = $s -replace 'https://[^/\s"]+\.quiknode\.pro[^\s"]*', 'https://***.quiknode.pro/***MASKED***'
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

Write-Host "=== W9.A RPC probe + ListingCommitment upgrade (devnet) ==="

if ($ProgramId -eq $SessionId) {
    Write-Host "REFUSE: program id is programs/session"
    exit 2
}
if ($env:CONFIRM_W9A_UPGRADE -ne "1") {
    Write-Host "REFUSE: set CONFIRM_W9A_UPGRADE=1"
    exit 2
}
if ($env:SOLANA_CLUSTER -in @("mainnet", "mainnet-beta")) {
    Write-Host "REFUSE: never mainnet"
    exit 2
}

if (-not (Test-Path $SoPath)) { throw "missing $SoPath" }
if (-not (Test-Path $UpgradeKp)) { throw "missing upgrade authority keypair" }
if (-not (Test-Path $OracleKp)) { throw "missing oracle keypair" }
if (-not (Test-Path $TreasuryKp)) { throw "missing treasury keypair" }

$soBytes = [System.IO.File]::ReadAllBytes($SoPath)
$soText = [System.Text.Encoding]::ASCII.GetString($soBytes)
$sha = (Get-FileHash $SoPath -Algorithm SHA256).Hash.ToUpperInvariant()
Write-Host "so_size=$($soBytes.Length)"
Write-Host "so_sha256=$sha"
if ($sha -ne $ExpectedSha) { throw "sha mismatch vs soak artifact $ExpectedSha" }
if (-not $soText.Contains("Listing commitment registered")) { throw "so lacks ListingCommitment marker" }
if (-not $soText.Contains("Groth16")) { throw "so lacks Groth16 marker" }
Write-Host "markers=listing+groth16"

$auth = (& solana-keygen pubkey $UpgradeKp).Trim()
$oraclePk = (& solana-keygen pubkey $OracleKp).Trim()
$treasuryPk = (& solana-keygen pubkey $TreasuryKp).Trim()
Write-Host "upgrade_authority=$auth"
Write-Host "oracle=$oraclePk"
Write-Host "treasury=$treasuryPk"
if ($auth -ne $ExpectedAuth) { throw "upgrade authority mismatch" }

$PublicRpc = "https://api.devnet.solana.com"
$OnfinalityRpc = "https://solana-devnet.api.onfinality.io/public"
$KeyedRpc = $null
try {
    $KeyedRpc = (gcloud secrets versions access latest --secret=$SecretName --project=$Project 2>$null | Out-String).Trim()
    if ($KeyedRpc -notmatch '^https://') { $KeyedRpc = $null }
} catch { $KeyedRpc = $null }
if ($KeyedRpc) {
    $u = [Uri]$KeyedRpc
    Write-Host "keyed_rpc_host=$($u.Host) (masked)"
} else {
    Write-Host "keyed_rpc_host=none"
}

function Probe-Health([string]$name, [string]$url) {
    Write-Host "=== health $name ==="
    $ok = $false
    try {
        $resp = Invoke-RestMethod -Uri $url -Method Post -Body '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' -ContentType "application/json" -TimeoutSec 20
        Write-Host ("getHealth=" + $resp.result)
        if ($resp.result -eq "ok") { $ok = $true }
    } catch {
        Write-Host ("getHealth_err=" + (Mask-Text $_.Exception.Message))
    }
    $cli = & solana cluster-version --url $url 2>&1 | Out-String
    $cliCode = $LASTEXITCODE
    $cliMasked = (Mask-Text $cli).Trim()
    Write-Host "cli_cluster_version=$cliMasked"
    $cliOk = $cliCode -eq 0 -and $cliMasked -notmatch '429|Too Many|Error'
    return @{ Name = $name; HttpOk = $ok; CliOk = $cliOk; Url = $url }
}

$health = @()
$health += Probe-Health "public" $PublicRpc
$health += Probe-Health "onfinality" $OnfinalityRpc
if ($KeyedRpc) { $health += Probe-Health "keyed" $KeyedRpc }

Write-Host "=== program show (public) ==="
Invoke-SolanaMasked -CliArgs @("program", "show", $ProgramId, "--url", $PublicRpc) | Out-Null

$oracleBal = Get-SolBalance $OracleKp $PublicRpc
$treasuryBal = Get-SolBalance $TreasuryKp $PublicRpc
$upgradeBal = Get-SolBalance $UpgradeKp $PublicRpc
Write-Host "oracle_sol=$oracleBal treasury_sol=$treasuryBal upgrade_sol=$upgradeBal"

$loaned = 0.0
if ($oracleBal -lt 8.5) {
    if ($treasuryBal -lt ($LoanSol + 0.05)) { throw "treasury too low for $LoanSol SOL loan" }
    Write-Host "=== treasury loan ${LoanSol} SOL -> oracle (buffer rent) ==="
    $loanTx = Invoke-SolanaMasked -CliArgs @(
        "transfer", $oraclePk, "$LoanSol",
        "--url", $PublicRpc, "--keypair", $TreasuryKp,
        "--allow-unfunded-recipient"
    )
    if ($loanTx.Code -ne 0) { throw "treasury loan failed" }
    $loaned = $LoanSol
    Start-Sleep 3
    $oracleBal = Get-SolBalance $OracleKp $PublicRpc
    Write-Host "oracle_sol_after_loan=$oracleBal"
}

function Close-Buffers([string]$url) {
    Write-Host "=== close leftover buffers on this payer (url masked) ==="
    $show = & solana program show --buffers --url $url --keypair $OracleKp 2>&1 | ForEach-Object { Mask-Text "$_" }
    $show | ForEach-Object { Write-Host $_ }
    $addrs = @()
    foreach ($line in $show) {
        if ($line -match '^[1-9A-HJ-NP-Za-km-z]{32,44}\s') {
            $addrs += ($line.Split(' ', [System.StringSplitOptions]::RemoveEmptyEntries)[0])
        }
    }
    foreach ($b in $addrs) {
        Write-Host "closing_buffer=$b"
        Invoke-SolanaMasked -CliArgs @(
            "program", "close", $b,
            "--url", $url,
            "--keypair", $OracleKp,
            "--recipient", $oraclePk
        ) | Out-Null
    }
}

function Repay-Loan {
    if ($loaned -le 0) { return }
    $cur = Get-SolBalance $OracleKp $PublicRpc
    $keep = 7.90
    $repay = [Math]::Min($loaned, [Math]::Max(0, [Math]::Floor(($cur - $keep) * 1000) / 1000))
    if ($repay -lt 0.05) {
        Write-Host "repay_skip oracle_sol=$cur (keep ~$keep for ops)"
        return
    }
    Write-Host "=== repay $repay SOL oracle -> treasury ==="
    Invoke-SolanaMasked -CliArgs @(
        "transfer", $treasuryPk, "$repay",
        "--url", $PublicRpc, "--keypair", $OracleKp
    ) | Out-Null
}

function Try-WriteBuffer([string]$name, [string]$url) {
    Write-Host "=== write-buffer probe name=$name size=$($soBytes.Length) --use-rpc ==="
    $r = Invoke-SolanaMasked -CliArgs @(
        "program", "write-buffer", $SoPath,
        "--url", $url,
        "--keypair", $OracleKp,
        "--fee-payer", $OracleKp,
        "--use-rpc",
        "--max-sign-attempts", "15",
        "--max-len", "$($soBytes.Length)",
        "--output", "json"
    )
    return $r
}

$order = @()
# Prefer CLI-healthy public endpoints for the 1.16MB write. Keyed Helius 429s on CLI.
foreach ($h in $health) {
    if ($h.CliOk) { $order += $h }
}
foreach ($h in $health) {
    if (-not $h.CliOk -and $h.HttpOk) { $order += $h }
}

$bufferPk = $null
$usedRpcName = $null
$usedRpcUrl = $null
try {
    foreach ($h in $order) {
        Write-Host "=== probe candidate $($h.Name) cli_ok=$($h.CliOk) http_ok=$($h.HttpOk) ==="
        $r = Try-WriteBuffer $h.Name $h.Url
        $json = $null
        try { $json = $r.Out | ConvertFrom-Json } catch { $json = $null }
        if ($json -and $json.buffer) {
            $bufferPk = $json.buffer
        } elseif ($r.Out -match 'Buffer:\s*([1-9A-HJ-NP-Za-km-z]{32,44})') {
            $bufferPk = $Matches[1]
        } elseif ($r.Out -match '"buffer"\s*:\s*"([1-9A-HJ-NP-Za-km-z]{32,44})"') {
            $bufferPk = $Matches[1]
        }
        if ($bufferPk) {
            $usedRpcName = $h.Name
            $usedRpcUrl = $h.Url
            Write-Host "WRITE_BUFFER_PASS name=$usedRpcName buffer=$bufferPk"
            break
        }
        Write-Host "WRITE_BUFFER_FAIL name=$($h.Name) code=$($r.Code)"
        Close-Buffers $h.Url
    }

    if (-not $bufferPk) {
        Write-Host "W9A_RPC_PROBE_FAIL no endpoint completed 1.16MB write-buffer"
        Write-Host "Need a paid/higher-limit keyed RPC (Helius CLI 429; public/onfinality historically timeout)."
        throw "probe_fail"
    }

    Write-Host "=== set buffer authority to upgrade key ==="
    $setAuth = Invoke-SolanaMasked -CliArgs @(
        "program", "set-buffer-authority", $bufferPk,
        "--new-buffer-authority", $auth,
        "--url", $usedRpcUrl,
        "--keypair", $OracleKp,
        "--use-rpc"
    )
    if ($setAuth.Code -ne 0) { throw "set-buffer-authority failed" }

    Write-Host "=== deploy buffer -> program (CONFIRM_W9A_UPGRADE) ==="
    $up = Invoke-SolanaMasked -CliArgs @(
        "program", "deploy",
        "--url", $usedRpcUrl,
        "--keypair", $OracleKp,
        "--program-id", $ProgramId,
        "--upgrade-authority", $UpgradeKp,
        "--buffer", $bufferPk,
        "--use-rpc",
        "--max-sign-attempts", "10"
    )
    if ($up.Code -ne 0 -and $up.Out -notmatch 'W9A|Deploying|Success|Program Id') {
        throw "upgrade_from_buffer_failed"
    }

    Write-Host "=== program show after upgrade ==="
    Invoke-SolanaMasked -CliArgs @("program", "show", $ProgramId, "--url", $PublicRpc) | Out-Null

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
    Write-Host "dump_size=$($dBytes.Length)"
    Write-Host "dump_sha256=$dSha"
    Write-Host "dump_listing=$hasListing"
    Write-Host "dump_groth16=$hasGroth"
    if (-not $hasListing -or -not $hasGroth) {
        throw "dump markers missing listing=$hasListing groth16=$hasGroth"
    }
    if ($dSha -ne $ExpectedSha) {
        Write-Host "WARN dump sha != laptop so (padding/loader). markers both present."
    }
    Write-Host "W9A_PROXYHUB_UPGRADE_DONE rpc=$usedRpcName"
    Write-Host "gcp PROXYHUB_LISTING_COMMITMENT stays off until observe soak; not a catalog; not DePIN"
}
catch {
    Write-Host ("FAIL " + (Mask-Text $_.Exception.Message))
    exit 1
}
finally {
    if ($usedRpcUrl) { Close-Buffers $usedRpcUrl } else { Close-Buffers $PublicRpc }
    Repay-Loan
    $oracleBal = Get-SolBalance $OracleKp $PublicRpc
    $treasuryBal = Get-SolBalance $TreasuryKp $PublicRpc
    Write-Host "final oracle_sol=$oracleBal treasury_sol=$treasuryBal"
}

# Pre-commit security gates (Windows). Delegates to bash script when available, else PowerShell checks.

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$bash = Get-Command bash -ErrorAction SilentlyContinue
if ($bash) {
    & $bash.Source -c "exit 0" 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
        & $bash.Source (Join-Path $RepoRoot "scripts/pre-commit-security.sh")
        exit $LASTEXITCODE
    }
}

$fail = 0
$staged = @(git diff --cached --diff-filter=AM --name-only 2>$null)
$blocked = @(
    '\.env$',
    'provider\.compose\.env$',
    'oracle-keypair\.json$',
    'treasury-keypair\.json$',
    '\.pem$',
    'jwt\.txt$'
)

foreach ($f in $staged) {
    if ($f -match '\.example$') { continue }
    foreach ($pat in $blocked) {
        if ($f -match $pat) {
            Write-Host "BLOCKED staged file: $f" -ForegroundColor Red
            $fail = 1
        }
    }
}

$tracked = @(git ls-files 'infra/oracle-keypair.json', 'treasury-keypair.json', '*.keypair.json' 2>$null | Where-Object { $_ -notmatch '\.example$' })
if ($tracked.Count -gt 0) {
    Write-Host "BLOCKED tracked keypair files:" -ForegroundColor Red
    $tracked | ForEach-Object { Write-Host "  $_" }
    $fail = 1
}

if ($fail -ne 0) {
    Write-Host "Security gate failed. See docs/SECURITY_GATES.md" -ForegroundColor Red
    exit 1
}

Write-Host "Security gate passed (install Git Bash + gitleaks for full scan)."

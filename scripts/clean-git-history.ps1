# clean-git-history.ps1
# Removes secrets from Git history using BFG Repo-Cleaner
# 
# ⚠️ WARNING: This is DESTRUCTIVE and requires coordination with your team
# All developers will need to re-clone the repository after this operation
#
# Prerequisites:
#   - Java Runtime (for BFG)
#   - Git
#   - Backup of your repository

param(
    [switch]$DryRun,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$RED = "`e[31m"
$GREEN = "`e[32m"
$YELLOW = "`e[33m"
$NC = "`e[0m"

Write-Host "${RED}╔════════════════════════════════════════════════════════════════╗${NC}"
Write-Host "${RED}║           GIT HISTORY CLEANUP - DANGER ZONE                    ║${NC}"
Write-Host "${RED}║           ⚠️  DESTRUCTIVE OPERATION ⚠️                         ║${NC}"
Write-Host "${RED}╚════════════════════════════════════════════════════════════════╝${NC}"
Write-Host ""
Write-Host "This script will:"
Write-Host "  1. Download BFG Repo-Cleaner"
Write-Host "  2. Remove .env files from ALL Git history"
Write-Host "  3. Remove keypair files from ALL Git history"
Write-Host "  4. Force push to origin (rewriting history)"
Write-Host ""
Write-Host "${YELLOW}CONSEQUENCES:${NC}"
Write-Host "  - All commit hashes will change"
Write-Host "  - Team members MUST re-clone the repository"
Write-Host "  - Any open PRs will need to be rebased"
Write-Host "  - Old forks will be orphaned"
Write-Host ""

if (-not $Force) {
    $confirm = Read-Host "Type 'DESTROY-AND-REBUILD' to continue"
    if ($confirm -ne "DESTROY-AND-REBUILD") {
        Write-Host "${RED}❌ Aborted.${NC}"
        exit 1
    }
}

# Check prerequisites
Write-Host "`n🔍 Checking prerequisites..."

# Check Git
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Error "Git is not installed or not in PATH"
    exit 1
}
Write-Host "  ✓ Git found"

# Check Java
$java = Get-Command java -ErrorAction SilentlyContinue
if (-not $java) {
    Write-Error "Java is required but not found. Please install Java Runtime."
    exit 1
}
Write-Host "  ✓ Java found"

# Check if we're in a git repository
if (-not (Test-Path ".git")) {
    Write-Error "Not a Git repository. Run this from the repository root."
    exit 1
}
Write-Host "  ✓ Git repository detected"

# Get repository info
$repoUrl = git remote get-url origin 2>$null
$currentBranch = git branch --show-current
Write-Host "  Repository: $repoUrl"
Write-Host "  Branch: $currentBranch"

# Check for uncommitted changes
$status = git status --porcelain
if ($status) {
    Write-Host "${YELLOW}⚠️  Uncommitted changes detected:${NC}"
    Write-Host $status
    $continue = Read-Host "Commit or stash these changes first. Continue anyway? (yes/no)"
    if ($continue -ne "yes") {
        exit 1
    }
}

# Download BFG if not present
$bfgJar = "bfg-1.14.0.jar"
if (-not (Test-Path $bfgJar)) {
    Write-Host "`n📥 Downloading BFG Repo-Cleaner..."
    $url = "https://repo1.maven.org/maven2/com/madgag/bfg/1.14.0/$bfgJar"
    
    try {
        Invoke-WebRequest -Uri $url -OutFile $bfgJar -UseBasicParsing
        Write-Host "  ✓ BFG downloaded"
    } catch {
        Write-Error "Failed to download BFG: $_"
        exit 1
    }
} else {
    Write-Host "  ✓ BFG already downloaded"
}

# Files to clean
$filesToClean = @(
    ".env",
    ".env.local",
    ".env.production",
    ".env.development",
    "oracle-keypair.json",
    "treasury-keypair.json",
    "provider-keypair.json",
    "*.keypair.json"
)

$stringsToClean = @(
    "sk_live_",           # Paystack secret keys
    "sk_test_",           # Paystack test keys
    "postgresql://",      # Database URLs
    "eyJhbGci",           # JWT tokens (base64 header)
    "-----BEGIN RSA",     # Private keys
    "-----BEGIN OPENSSH"  # SSH keys
)

if ($DryRun) {
    Write-Host "`n${YELLOW}🔍 DRY RUN MODE - No changes will be made${NC}"
    Write-Host "Files that would be removed from history:"
    foreach ($file in $filesToClean) {
        Write-Host "  - $file"
    }
    Write-Host "`nStrings that would be replaced:"
    foreach ($str in $stringsToClean) {
        Write-Host "  - $str***"
    }
    exit 0
}

# Create backup
$backupDir = "../git-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Write-Host "`n💾 Creating backup..."
git clone --mirror . $backupDir
Write-Host "  ✓ Backup created at $backupDir"

# Run BFG
Write-Host "`n🧹 Cleaning Git history..."

# Remove files
foreach ($file in $filesToClean) {
    Write-Host "  Removing $file from history..."
    java -jar $bfgJar --delete-files $file .
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "BFG reported issues with $file, continuing..."
    }
}

# Replace strings (create replacement file)
$replaceFile = "bfg-replacements.txt"
$replacements = @"
sk_live_==>sk_live_REMOVED_
sk_test_==>sk_test_REMOVED_
postgresql://==>postgresql://REMOVED@
eyJhbGci==>REMOVED_JWT
-----BEGIN RSA==>REMOVED_RSA_KEY
-----BEGIN OPENSSH==>REMOVED_SSH_KEY
"@

$replacements | Out-File -FilePath $replaceFile -Encoding UTF8

Write-Host "  Replacing sensitive strings..."
java -jar $bfgJar --replace-text $replaceFile .

Remove-Item $replaceFile

# Clean up
Write-Host "`n🧽 Running git cleanup..."
git reflog expire --expire=now --all
if ($LASTEXITCODE -ne 0) {
    Write-Warning "git reflog reported issues, continuing..."
}

git gc --prune=now --aggressive
if ($LASTEXITCODE -ne 0) {
    Write-Warning "git gc reported issues, continuing..."
}

# Verify cleanup
Write-Host "`n🔍 Verifying cleanup..."
$foundSecrets = $false

foreach ($file in $filesToClean) {
    $result = git log --all --full-history -- "$file" 2>&1
    if ($result) {
        Write-Host "${RED}  ✗ $file still found in history!${NC}"
        $foundSecrets = $true
    } else {
        Write-Host "${GREEN}  ✓ $file removed from history${NC}"
    }
}

if ($foundSecrets) {
    Write-Host "`n${YELLOW}⚠️  Some files may still be in history.${NC}"
    Write-Host "You may need to manually review or run BFG again."
}

# Calculate size reduction
$sizeBefore = (git count-objects -vH | Select-String "size-pack:").ToString()
Write-Host "`n📊 Repository status after cleanup:"
Write-Host "  $sizeBefore"

# Ready to push
Write-Host "`n${GREEN}✅ History cleanup complete!${NC}"
Write-Host ""
Write-Host "${YELLOW}NEXT STEPS:${NC}"
Write-Host ""
Write-Host "1. Review the changes:"
Write-Host "   git log --oneline -10"
Write-Host ""
Write-Host "2. If everything looks good, FORCE PUSH:"
Write-Host "   ${RED}git push origin $currentBranch --force-with-lease${NC}"
Write-Host ""
Write-Host "3. Notify your team:"
Write-Host "   - Everyone must re-clone the repository"
Write-Host "   - All open PRs need to be rebased"
Write-Host "   - Any forks need to be updated"
Write-Host ""
Write-Host "4. IMMEDIATELY after push:"
Write-Host "   - Rotate ALL credentials"
Write-Host "   - Update production secrets"
Write-Host "   - Verify services still work"
Write-Host ""
Write-Host "${RED}⚠️  DO NOT DELAY THE FORCE PUSH -${NC}"
Write-Host "${RED}   The longer you wait, the more likely someone pushes old history${NC}"

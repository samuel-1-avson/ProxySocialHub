# install-git-hooks.ps1
# Installs Git hooks to prevent accidental secret commits

param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$GREEN = "`e[32m"
$YELLOW = "`e[33m"
$RED = "`e[31m"
$NC = "`e[0m"

Write-Host "${GREEN}🔧 Git Hooks Installer${NC}"
Write-Host "====================="
Write-Host ""

# Check if we're in a git repo
if (-not (Test-Path ".git")) {
    Write-Error "Not a Git repository. Run this from the repository root."
    exit 1
}

$hooksDir = ".git/hooks"
if (-not (Test-Path $hooksDir)) {
    New-Item -ItemType Directory -Force -Path $hooksDir | Out-Null
}

# Pre-commit hook
$preCommitHook = @'
#!/bin/sh
# Pre-commit hook to prevent secret commits
# Automatically installed by ProxySocialHub security setup

echo "🔍 Running pre-commit security checks..."

# Colors (if terminal supports it)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Track if we find any issues
FOUND_ISSUES=0

# Check for .env files
echo "Checking for .env files..."
if git diff --cached --name-only | grep -E '^\.env' > /dev/null 2>&1; then
    echo "${RED}❌ ERROR: Attempting to commit .env file!${NC}"
    echo "Remove it with: git rm --cached <filename>"
    echo "Add to .gitignore if not already there"
    FOUND_ISSUES=1
fi

# Check for private keys
echo "Checking for private keys..."
if git diff --cached --name-only | grep -E '\.(key|pem|keypair\.json)$' > /dev/null 2>&1; then
    echo "${RED}❌ ERROR: Attempting to commit private key!${NC}"
    echo "Remove it with: git rm --cached <filename>"
    FOUND_ISSUES=1
fi

# Check for Solana keypairs
echo "Checking for keypair files..."
if git diff --cached --name-only | grep -E 'keypair.*\.json$' > /dev/null 2>&1; then
    echo "${RED}❌ ERROR: Attempting to commit keypair file!${NC}"
    echo "Remove it with: git rm --cached <filename>"
    FOUND_ISSUES=1
fi

# Check for potential secrets in staged files
echo "Checking for potential secrets in code..."

# Patterns to check
PATTERNS="
sk_live_
sk_test_
password\s*=
secret\s*=
apikey\s*=
api_key\s*=
BEGIN RSA PRIVATE KEY
BEGIN OPENSSH PRIVATE KEY
postgresql://.*:.*@
mongodb://.*:.*@
"

# Check each staged file
for file in $(git diff --cached --name-only | grep -E '\.(go|js|ts|json|yaml|yml|env)$'); do
    if [ -f "$file" ]; then
        for pattern in $PATTERNS; do
            if git diff --cached "$file" | grep -i "$pattern" > /dev/null 2>&1; then
                echo "${YELLOW}⚠️  WARNING: Potential secret pattern found in $file${NC}"
                echo "   Pattern: $pattern"
                echo "   Review the changes before committing"
                # Don't block, just warn for patterns
            fi
        done
    fi
done

# Check file sizes (prevent accidental commit of large files)
echo "Checking file sizes..."
MAX_SIZE=10485760  # 10MB
while read -r file; do
    if [ -f "$file" ]; then
        size=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null || echo 0)
        if [ "$size" -gt "$MAX_SIZE" ]; then
            echo "${YELLOW}⚠️  WARNING: Large file detected: $file ($(($size / 1048576))MB)${NC}"
        fi
    fi
done < <(git diff --cached --name-only)

# If issues found, block commit
if [ $FOUND_ISSUES -eq 1 ]; then
    echo ""
    echo "${RED}❌ Commit blocked due to security issues${NC}"
    echo "Fix the issues above and try again"
    exit 1
fi

# Run tests if available
if [ -f "package.json" ] && grep -q "test" package.json 2>/dev/null; then
    echo "Running tests..."
    if ! npm test -- --watchAll=false 2>/dev/null; then
        echo "${YELLOW}⚠️  Tests failed${NC}"
        # Don't block, just warn
    fi
elif [ -f "go.mod" ]; then
    echo "Running Go tests..."
    if ! go test ./... -short 2>/dev/null; then
        echo "${YELLOW}⚠️  Tests failed${NC}"
        # Don't block, just warn
    fi
fi

echo "${GREEN}✅ Pre-commit checks passed${NC}"
exit 0
'@

# Write pre-commit hook
$preCommitPath = "$hooksDir/pre-commit"
if ((Test-Path $preCommitPath) -and -not $Force) {
    Write-Host "${YELLOW}⚠️  Pre-commit hook already exists${NC}"
    $overwrite = Read-Host "Overwrite? (yes/no)"
    if ($overwrite -ne "yes") {
        Write-Host "Skipping..."
        exit 0
    }
}

$preCommitHook | Out-File -FilePath $preCommitPath -Encoding UTF8

# Make executable (Git Bash/WSL)
if (Get-Command chmod -ErrorAction SilentlyContinue) {
    chmod +x $preCommitPath
}

Write-Host "${GREEN}✅ Pre-commit hook installed${NC}"

# Pre-push hook (optional but recommended)
$prePushHook = @'
#!/bin/sh
# Pre-push hook

echo "🔍 Running pre-push checks..."

# Check if we're pushing to main/master
default_branch=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
protected_branches="main master $default_branch"

current_branch=$(git symbolic-ref --short HEAD)
remote_branch=$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || echo "")

for branch in $protected_branches; do
    if echo "$remote_branch" | grep -q "$branch"; then
        echo "⚠️  Pushing to protected branch: $branch"
        echo "Make sure all tests pass and code is reviewed"
        
        # Run full test suite
        if [ -f "go.mod" ]; then
            echo "Running full test suite..."
            if ! go test ./... -race; then
                echo "❌ Tests failed. Push aborted."
                exit 1
            fi
        fi
    fi
done

echo "✅ Pre-push checks passed"
exit 0
'@

$prePushPath = "$hooksDir/pre-push"
$prePushHook | Out-File -FilePath $prePushPath -Encoding UTF8

if (Get-Command chmod -ErrorAction SilentlyContinue) {
    chmod +x $prePushPath
}

Write-Host "${GREEN}✅ Pre-push hook installed${NC}"

# Commit-msg hook (enforce conventional commits)
$commitMsgHook = @'
#!/bin/sh
# Commit message hook

commit_msg_file=$1
commit_msg=$(head -n1 "$commit_msg_file")

# Check for security keywords
if echo "$commit_msg" | grep -qiE "(password|secret|key|credential|token)"; then
    echo "⚠️  Warning: Commit message contains sensitive keywords"
    echo "   Make sure you're not committing actual secrets in the message"
fi

# Enforce conventional commits (optional)
# pattern="^(feat|fix|docs|style|refactor|test|chore)(\(.+\))?: .+"
# if ! echo "$commit_msg" | grep -qE "$pattern"; then
#     echo "❌ Commit message doesn't follow conventional commit format"
#     echo "Format: type(scope): message"
#     exit 1
# fi

exit 0
'@

$commitMsgPath = "$hooksDir/commit-msg"
$commitMsgHook | Out-File -FilePath $commitMsgPath -Encoding UTF8

if (Get-Command chmod -ErrorAction SilentlyContinue) {
    chmod +x $commitMsgPath
}

Write-Host "${GREEN}✅ Commit-msg hook installed${NC}"

Write-Host ""
Write-Host "${GREEN}🎉 All Git hooks installed successfully!${NC}"
Write-Host ""
Write-Host "Hooks installed:"
Write-Host "  - pre-commit: Blocks .env and private key commits"
Write-Host "  - pre-push: Runs tests before pushing to protected branches"
Write-Host "  - commit-msg: Warns about sensitive keywords"
Write-Host ""
Write-Host "To bypass hooks in emergencies (use with caution):"
Write-Host "  git commit --no-verify"
Write-Host "  git push --no-verify"

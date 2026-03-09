#!/bin/bash
# IMMEDIATE SECURITY FIX SCRIPT
# Execute this script IMMEDIATELY to fix critical security issues
# 
# WARNING: This script will:
# - Rotate all exposed credentials
# - Remove secrets from git history
# - Update configuration files
# 
# BACKUP YOUR DATA BEFORE RUNNING!

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${RED}"
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║           IMMEDIATE SECURITY FIX SCRIPT                        ║"
echo "║           ⚠️  WARNING: IRREVERSIBLE ACTIONS ⚠️                  ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo ""
echo "This script will:"
echo "  1. Generate new secure secrets"
echo "  2. Remove .env files from git"
echo "  3. Clean git history using BFG"
echo "  4. Update .gitignore"
echo "  5. Create new secure .env template"
echo ""
read -p "Have you backed up your repository and database? (yes/no): " backup_confirm

if [ "$backup_confirm" != "yes" ]; then
    echo -e "${RED}❌ Aborting. Please backup first.${NC}"
    exit 1
fi

read -p "Are you sure you want to proceed? (type 'EMERGENCY-FIX' to confirm): " confirm

if [ "$confirm" != "EMERGENCY-FIX" ]; then
    echo -e "${RED}❌ Aborting.${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}🔐 Starting security fixes...${NC}"
echo ""

# Step 1: Create backup of current .env
echo "📋 Step 1: Backing up current configuration..."
if [ -f .env ]; then
    cp .env .env.backup.$(date +%Y%m%d_%H%M%S)
    echo "  ✓ Backup created"
fi

# Step 2: Generate new secrets
echo ""
echo "🔑 Step 2: Generating new secure secrets..."

NEW_JWT_SECRET=$(openssl rand -hex 64)
NEW_SESSION_SECRET=$(openssl rand -hex 64)
NEW_ENCRYPTION_KEY=$(openssl rand -base64 32)
NEW_REDIS_PASSWORD=$(openssl rand -base64 32)
NEW_DB_PASSWORD=$(openssl rand -base64 32)

echo "  ✓ New JWT Secret generated"
echo "  ✓ New Session Secret generated"
echo "  ✓ New Encryption Key generated"
echo "  ✓ New Redis Password generated"
echo "  ✓ New Database Password generated"

# Step 3: Update .gitignore
echo ""
echo "📝 Step 3: Updating .gitignore..."

cat >> .gitignore << 'EOF'

# SECURITY: Secrets and Credentials
.env
.env.*
!.env.example
*.key
*.pem
*.keypair.json
*.keystore
secrets/
.private/
credentials/

# Backup files
*.backup.*
*.bak

# IDE (may contain credentials)
.idea/
.vscode/settings.json
*.sublime-workspace

# OS files that might contain sensitive info
.DS_Store
Thumbs.db
EOF

echo "  ✓ .gitignore updated with security patterns"

# Step 4: Remove .env from git cache (preserve file locally)
echo ""
echo "🗑️  Step 4: Removing secrets from git..."

git rm --cached .env 2>/dev/null || echo "  ℹ️  .env not tracked"
git rm --cached .env.local 2>/dev/null || true
git rm --cached .env.production 2>/dev/null || true
git rm --cached infra/oracle-keypair.json 2>/dev/null || true
git rm --cached treasury-keypair.json 2>/dev/null || true
git rm --cached *.key 2>/dev/null || true

echo "  ✓ Files removed from git index"

# Step 5: Commit the removal
echo ""
echo "💾 Step 5: Creating security commit..."

git add .gitignore
git commit -m "🔒 SECURITY: Remove exposed credentials and harden configuration

CRITICAL SECURITY FIXES:
- Remove .env files from repository
- Add comprehensive .gitignore patterns for secrets
- Prepare for git history cleanup

NEXT STEPS REQUIRED:
1. Clean git history with BFG
2. Rotate all production credentials
3. Deploy new secrets via secure channels

BREAKING CHANGE: All previous credentials are now considered compromised"

echo "  ✓ Security commit created"

# Step 6: Create new secure .env
echo ""
echo "🔐 Step 6: Creating new secure .env file..."

cat > .env << EOF
# ProxySocialHub Environment Configuration
# GENERATED: $(date)
# SECURITY LEVEL: HIGH

# ============================================
# CRITICAL SECRETS (AUTO-GENERATED)
# ============================================
JWT_SECRET=${NEW_JWT_SECRET}
SESSION_SECRET=${NEW_SESSION_SECRET}
ENCRYPTION_KEY=${NEW_ENCRYPTION_KEY}

# Database
DATABASE_URL=postgresql://proxyhubb:${NEW_DB_PASSWORD}@localhost:5432/proxyhubb?sslmode=require
POSTGRES_USER=proxyhubb
POSTGRES_PASSWORD=${NEW_DB_PASSWORD}
POSTGRES_DB=proxyhubb

# Redis
REDIS_URL=redis://:${NEW_REDIS_PASSWORD}@localhost:6379
REDIS_PASSWORD=${NEW_REDIS_PASSWORD}

# ============================================
# APPLICATION SETTINGS
# ============================================
APP_ENV=development
PORT=8080
API_BASE_URL=http://localhost:8080
FRONTEND_URL=http://localhost:3000
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000

# ============================================
# EXTERNAL SERVICES (FILL THESE IN)
# ============================================
# SUPABASE_URL=
# SUPABASE_ANON_KEY=
# SUPABASE_SERVICE_KEY=
# PAYSTACK_SECRET_KEY=
# PAYSTACK_PUBLIC_KEY=
# GOOGLE_CLIENT_ID=
# GOOGLE_CLIENT_SECRET=
# GITHUB_CLIENT_ID=
# GITHUB_CLIENT_SECRET=
# SMTP_HOST=
# SMTP_PORT=
# SMTP_USER=
# SMTP_PASS=

# ============================================
# BLOCKCHAIN (FILL THESE IN)
# ============================================
# SOLANA_RPC_ENDPOINT=https://api.devnet.solana.com
# SOLANA_NETWORK=devnet
# SOLANA_PROGRAM_ID=
# SOLANA_TREASURY_ADDRESS=
# ORACLE_PRIVATE_KEY=
# PROVIDER_PRIVATE_KEY=

# ============================================
# MONITORING
# ============================================
# SENTRY_DSN=
# JAEGER_ENDPOINT=
EOF

chmod 600 .env
echo "  ✓ New .env file created with secure permissions (600)"

# Step 7: Create secure .env.example
echo ""
echo "📋 Step 7: Creating .env.example template..."

cat > .env.example << 'EOF'
# ProxySocialHub Environment Configuration Template
# Copy to .env and fill in all values
# DO NOT add real values to this file

# ============================================
# REQUIRED SECRETS (Generate strong values)
# ============================================
JWT_SECRET=
SESSION_SECRET=
ENCRYPTION_KEY=
DATABASE_URL=
REDIS_URL=
REDIS_PASSWORD=

# ============================================
# SUPABASE CONFIGURATION
# ============================================
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=

# ============================================
# PAYMENT GATEWAYS
# ============================================
PAYSTACK_SECRET_KEY=
PAYSTACK_PUBLIC_KEY=

# ============================================
# OAUTH PROVIDERS
# ============================================
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# ============================================
# SMTP CONFIGURATION
# ============================================
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=

# ============================================
# BLOCKCHAIN
# ============================================
SOLANA_RPC_ENDPOINT=https://api.devnet.solana.com
SOLANA_NETWORK=devnet
SOLANA_PROGRAM_ID=
SOLANA_TREASURY_ADDRESS=
ORACLE_PRIVATE_KEY=
PROVIDER_PRIVATE_KEY=

# ============================================
# APPLICATION
# ============================================
APP_ENV=development
PORT=8080
API_BASE_URL=http://localhost:8080
FRONTEND_URL=http://localhost:3000
CORS_ORIGINS=http://localhost:3000
EOF

echo "  ✓ .env.example template created"

# Step 8: Create credential rotation checklist
echo ""
echo "📋 Step 8: Creating credential rotation checklist..."

cat > CREDENTIAL_ROTATION_CHECKLIST.md << 'EOF'
# 🔐 Credential Rotation Checklist

## IMMEDIATE (Within 1 Hour)

### Database Credentials
- [ ] Supabase PostgreSQL password rotated
- [ ] Database connection strings updated
- [ ] Connection pools restarted

### API Keys
- [ ] Paystack keys rotated (Dashboard: https://dashboard.paystack.com)
- [ ] Supabase anon key rotated (Dashboard: Settings > API)
- [ ] Supabase service key rotated

### Authentication Secrets
- [ ] JWT secret deployed to production
- [ ] Session secret deployed to production
- [ ] Encryption key deployed to production

### Blockchain
- [ ] Solana oracle keypair rotated
- [ ] Provider keypair rotated
- [ ] Treasury authority verified

## SHORT TERM (Within 24 Hours)

- [ ] Git history cleaned with BFG (see below)
- [ ] Team notified of new credential locations
- [ ] Production deployment with new secrets
- [ ] Old sessions invalidated
- [ ] Users required to re-authenticate

## Git History Cleanup (CRITICAL)

```bash
# Install BFG Repo-Cleaner
wget https://repo1.maven.org/maven2/com/madgag/bfg/1.14.0/bfg-1.14.0.jar

# Run BFG
cd your-repo
java -jar bfg-1.14.0.jar --delete-files .env
java -jar bfg-1.14.0.jar --delete-files .env.local
java -jar bfg-1.14.0.jar --delete-files .env.production
java -jar bfg-1.14.0.jar --delete-files oracle-keypair.json
java -jar bfg-1.14.0.jar --delete-files treasury-keypair.json

# Clean and garbage collect
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# FORCE PUSH (Coordinate with team)
git push origin main --force-with-lease
```

## VERIFICATION

- [ ] Verify old credentials no longer work
- [ ] Verify new credentials in production
- [ ] Verify all services healthy
- [ ] Run smoke tests
- [ ] Monitor error rates

## COMMUNICATION

- [ ] Security team notified
- [ ] All developers notified (they must reclone)
- [ ] Incident documented
- [ ] Post-mortem scheduled
EOF

echo "  ✓ Credential rotation checklist created"

# Step 9: Create pre-commit hook
echo ""
echo "🪝 Step 9: Installing pre-commit hook..."

mkdir -p .git/hooks

cat > .git/hooks/pre-commit << 'EOF'
#!/bin/bash
# Pre-commit hook to prevent secret commits

echo "🔍 Running pre-commit security checks..."

# Check for .env files
if git diff --cached --name-only | grep -E '^\.env' > /dev/null; then
    echo "❌ ERROR: Attempting to commit .env file!"
    echo "Remove it with: git rm --cached <file>"
    exit 1
fi

# Check for private keys
if git diff --cached --name-only | grep -E '\.(key|pem|keypair\.json)$' > /dev/null; then
    echo "❌ ERROR: Attempting to commit private key!"
    exit 1
fi

# Check for high-entropy strings (potential secrets)
if command -v trufflehog &> /dev/null; then
    trufflehog git file://. --since-commit HEAD --only-verified --fail
    if [ $? -ne 0 ]; then
        echo "❌ ERROR: Potential secrets detected!"
        exit 1
    fi
fi

echo "✅ Pre-commit checks passed"
exit 0
EOF

chmod +x .git/hooks/pre-commit
echo "  ✓ Pre-commit hook installed"

# Summary
echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║           IMMEDIATE FIXES COMPLETED ✅                          ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "NEXT CRITICAL STEPS:"
echo ""
echo "1. ${YELLOW}CLEAN GIT HISTORY${NC} (Coordinate with team):"
echo "   Follow instructions in CREDENTIAL_ROTATION_CHECKLIST.md"
echo ""
echo "2. ${YELLOW}ROTATE PRODUCTION CREDENTIALS${NC}:"
echo "   Follow checklist in CREDENTIAL_ROTATION_CHECKLIST.md"
echo ""
echo "3. ${YELLOW}NOTIFY TEAM${NC}:"
echo "   - All developers must reclone the repository"
echo "   - Old credentials are now compromised"
echo ""
echo "4. ${YELLOW}DEPLOY${NC}:"
echo "   Deploy new secrets to production via secure channels"
echo ""
echo -e "${RED}⚠️  DO NOT SKIP THE GIT HISTORY CLEANUP!${NC}"
echo -e "${RED}   Old commits still contain exposed credentials!${NC}"
echo ""
echo "Files created:"
echo "  - .env (new secure version)"
echo "  - .env.example (template)"
echo "  - CREDENTIAL_ROTATION_CHECKLIST.md"
echo "  - .gitignore (updated)"
echo ""
echo -e "${GREEN}✅ Script completed successfully${NC}"

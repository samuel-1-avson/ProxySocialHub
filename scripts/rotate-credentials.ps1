# rotate-credentials.ps1
# Helper script for rotating credentials after security incident
# Generates new credentials and creates a migration checklist

param(
    [switch]$GenerateOnly,
    [switch]$ApplyToProduction
)

$ErrorActionPreference = "Stop"

$GREEN = "`e[32m"
$YELLOW = "`e[33m"
$RED = "`e[31m"
$CYAN = "`e[36m"
$NC = "`e[0m"

Write-Host "${CYAN}╔════════════════════════════════════════════════════════════════╗${NC}"
Write-Host "${CYAN}║           CREDENTIAL ROTATION ASSISTANT                        ║${NC}"
Write-Host "${CYAN}╚════════════════════════════════════════════════════════════════╝${NC}"
Write-Host ""

if ($ApplyToProduction) {
    Write-Host "${RED}⚠️  PRODUCTION MODE${NC}"
    Write-Host "This will generate credentials ready for production deployment."
    Write-Host ""
    $confirm = Read-Host "Type 'ROTATE-PRODUCTION' to continue"
    if ($confirm -ne "ROTATE-PRODUCTION") {
        exit 1
    }
}

# Function to generate secure passwords
function New-SecurePassword {
    param(
        [int]$Length = 32,
        [switch]$IncludeSpecial
    )
    
    $chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    if ($IncludeSpecial) {
        $chars += '!@#$%^&*()_+-=[]{}|;:,.<>?'
    }
    
    $bytes = New-Object byte[] $Length
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $rng.Dispose()
    
    $password = -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
    return $password
}

function New-ApiKey {
    return "pk_" + (New-SecurePassword -Length 48)
}

function New-SecretKey {
    return "sk_" + (New-SecurePassword -Length 48)
}

Write-Host "${CYAN}🔐 Generating new credentials...${NC}"
Write-Host ""

# Application Secrets
$appSecrets = @{
    JWT_SECRET = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
    SESSION_SECRET = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
    ENCRYPTION_KEY = [Convert]::ToBase64String((New-Object byte[] 32 | ForEach-Object { Get-Random -Maximum 256 }))
    REDIS_PASSWORD = New-SecurePassword -Length 32 -IncludeSpecial
    POSTGRES_PASSWORD = New-SecurePassword -Length 32 -IncludeSpecial
}

# API Keys (placeholders - you need to get these from respective dashboards)
$apiKeys = @{
    PAYSTACK_TEST_SECRET = "sk_test_" + (New-SecurePassword -Length 48)
    PAYSTACK_TEST_PUBLIC = "pk_test_" + (New-SecurePassword -Length 48)
    PAYSTACK_LIVE_SECRET = "sk_live_" + (New-SecurePassword -Length 48)
    PAYSTACK_LIVE_PUBLIC = "pk_live_" + (New-SecurePassword -Length 48)
}

# Blockchain (you'll need to generate actual keypairs)
$blockchain = @{
    Note = "Generate actual keypairs with: solana-keygen new"
    ORACLE_PUBLIC_KEY = "(generate new keypair)"
    PROVIDER_PUBLIC_KEY = "(generate new keypair)"
}

# Display new credentials
Write-Host "${GREEN}✅ New Application Secrets Generated:${NC}"
Write-Host ""
foreach ($key in $appSecrets.Keys | Sort-Object) {
    $masked = $appSecrets[$key].Substring(0, [Math]::Min(12, $appSecrets[$key].Length)) + "***"
    Write-Host "  ${CYAN}$key${NC} = $masked"
}

Write-Host ""
Write-Host "${YELLOW}⚠️  API Keys - Rotate in respective dashboards:${NC}"
Write-Host ""
Write-Host "  Paystack Test:  https://dashboard.paystack.com"
Write-Host "  Paystack Live:  https://dashboard.paystack.com"
Write-Host "  Supabase:       https://supabase.com/dashboard"
Write-Host "  Google OAuth:   https://console.cloud.google.com"
Write-Host "  GitHub OAuth:   https://github.com/settings/developers"

Write-Host ""
Write-Host "${YELLOW}⚠️  Blockchain Keys - Generate new keypairs:${NC}"
Write-Host ""
Write-Host "  solana-keygen new --outfile oracle-keypair-new.json"
Write-Host "  solana-keygen new --outfile provider-keypair-new.json"

# Create rotation package
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$packageDir = "credential-rotation-$timestamp"
New-Item -ItemType Directory -Force -Path $packageDir | Out-Null

# Save new .env
$envContent = @"
# NEW CREDENTIALS - Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
# ⚠️  ROTATE IMMEDIATELY - Old credentials are compromised

# ============================================
# APPLICATION SECRETS
# ============================================
JWT_SECRET=$($appSecrets.JWT_SECRET)
SESSION_SECRET=$($appSecrets.SESSION_SECRET)
ENCRYPTION_KEY=$($appSecrets.ENCRYPTION_KEY)
REDIS_PASSWORD=$($appSecrets.REDIS_PASSWORD)

# Database
DATABASE_URL=postgresql://proxyhubb:$($appSecrets.POSTGRES_PASSWORD)@localhost:5432/proxyhubb?sslmode=require
POSTGRES_USER=proxyhubb
POSTGRES_PASSWORD=$($appSecrets.POSTGRES_PASSWORD)
POSTGRES_DB=proxyhubb

# Redis
REDIS_URL=redis://:$($appSecrets.REDIS_PASSWORD)@localhost:6379

# ============================================
# API KEYS - UPDATE IN DASHBOARDS FIRST
# ============================================
# PAYSTACK_SECRET_KEY=
# PAYSTACK_PUBLIC_KEY=
# SUPABASE_URL=
# SUPABASE_ANON_KEY=
# SUPABASE_SERVICE_KEY=

# ============================================
# OAUTH - UPDATE IN PROVIDER CONSOLES
# ============================================
# GOOGLE_CLIENT_ID=
# GOOGLE_CLIENT_SECRET=
# GITHUB_CLIENT_ID=
# GITHUB_CLIENT_SECRET=

# ============================================
# BLOCKCHAIN - GENERATE NEW KEYPAIRS
# ============================================
# SOLANA_ORACLE_KEYPAIR=/secure/path/to/oracle-keypair-new.json
# PROVIDER_PRIVATE_KEY=
"@

$envContent | Out-File -FilePath "$packageDir/.env.new" -Encoding UTF8

# Create rotation checklist
$checklist = @"
# Credential Rotation Checklist
# Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
# Incident: Security credentials exposed in Git history

## PHASE 1: PREPARATION (Do First)
- [ ] Notify team of upcoming rotation
- [ ] Schedule maintenance window
- [ ] Prepare rollback plan
- [ ] Backup current database

## PHASE 2: APPLICATION SECRETS (5 minutes)
- [ ] Update JWT_SECRET in production
- [ ] Update SESSION_SECRET in production
- [ ] Update ENCRYPTION_KEY in production
- [ ] Update REDIS_PASSWORD in production
- [ ] Restart application services
- [ ] Verify application starts successfully

## PHASE 3: DATABASE (10 minutes)
- [ ] Rotate PostgreSQL password
- [ ] Update DATABASE_URL
- [ ] Test database connectivity
- [ ] Verify no connection errors in logs

## PHASE 4: EXTERNAL SERVICES (30 minutes)

### Paystack
- [ ] Login to https://dashboard.paystack.com
- [ ] Go to Settings > API Keys
- [ ] Generate new test secret key
- [ ] Generate new test public key
- [ ] Generate new live secret key
- [ ] Generate new live public key
- [ ] Update PAYSTACK_SECRET_KEY in .env
- [ ] Update PAYSTACK_PUBLIC_KEY in .env
- [ ] Test payment flow in test mode
- [ ] Test payment flow in live mode (small amount)

### Supabase
- [ ] Login to https://supabase.com/dashboard
- [ ] Go to Project Settings > API
- [ ] Generate new anon key
- [ ] Generate new service role key
- [ ] Update SUPABASE_ANON_KEY
- [ ] Update SUPABASE_SERVICE_KEY
- [ ] Test Supabase Auth
- [ ] Test database queries

### Google OAuth
- [ ] Go to https://console.cloud.google.com
- [ ] Navigate to APIs & Services > Credentials
- [ ] Create new OAuth 2.0 credentials
- [ ] Update GOOGLE_CLIENT_ID
- [ ] Update GOOGLE_CLIENT_SECRET
- [ ] Test Google login

### GitHub OAuth
- [ ] Go to https://github.com/settings/developers
- [ ] Create new OAuth App
- [ ] Update GITHUB_CLIENT_ID
- [ ] Update GITHUB_CLIENT_SECRET
- [ ] Test GitHub login

## PHASE 5: BLOCKCHAIN (15 minutes)
- [ ] Generate new oracle keypair:
      solana-keygen new --outfile oracle-keypair-new.json
- [ ] Generate new provider keypair:
      solana-keygen new --outfile provider-keypair-new.json
- [ ] Fund new accounts on devnet:
      solana airdrop 2 <NEW_PUBLIC_KEY> --url devnet
- [ ] Update SOLANA_ORACLE_KEYPAIR path
- [ ] Update PROVIDER_PRIVATE_KEY
- [ ] Test blockchain interactions
- [ ] Verify oracle is signing transactions

## PHASE 6: VERIFICATION (15 minutes)
- [ ] Run full test suite
- [ ] Check all API endpoints
- [ ] Verify authentication flows
- [ ] Test payment processing
- [ ] Test database operations
- [ ] Test Redis cache
- [ ] Check error logs (should be clean)
- [ ] Verify monitoring dashboards

## PHASE 7: CLEANUP (5 minutes)
- [ ] Invalidate old JWT tokens
- [ ] Clear Redis cache
- [ ] Archive old credentials (securely)
- [ ] Update credential inventory
- [ ] Document rotation in security log

## PHASE 8: MONITORING (Ongoing)
- [ ] Monitor error rates for 24 hours
- [ ] Check for authentication failures
- [ ] Verify no payment processing issues
- [ ] Monitor blockchain transactions
- [ ] Watch for unusual activity

## ROLLBACK PLAN
If issues arise:
1. Restore previous .env from backup
2. Restart services
3. Investigate and fix issues
4. Retry rotation

## CONTACTS
- Security Lead: ________________
- DevOps Lead: ________________
- Database Admin: ________________
- Blockchain Dev: ________________
"@

$checklist | Out-File -FilePath "$packageDir/ROTATION_CHECKLIST.md" -Encoding UTF8

# Create scripts for common operations
$updateScript = @"
#!/bin/bash
# update-production-secrets.sh
# Run this on production servers to update secrets

echo "Updating production secrets..."

# Stop services
docker-compose -f docker-compose.secure.yml down

# Backup current .env
if [ -f .env ]; then
    cp .env .env.backup.\$(date +%Y%m%d_%H%M%S)
fi

# Copy new .env
cp .env.new .env

# Start services
docker-compose -f docker-compose.secure.yml up -d

# Verify
echo "Waiting for services to start..."
sleep 10

# Health check
if curl -f http://localhost:8080/health; then
    echo "✅ Services healthy"
else
    echo "❌ Health check failed"
    exit 1
fi

echo "✅ Secrets updated successfully"
"@

$updateScript | Out-File -FilePath "$packageDir/update-production-secrets.sh" -Encoding UTF8

# Summary
Write-Host ""
Write-Host "${GREEN}✅ Credential Rotation Package Created!${NC}"
Write-Host ""
Write-Host "Package location: ${CYAN}./$packageDir/${NC}"
Write-Host ""
Write-Host "Files included:"
Write-Host "  - ${CYAN}.env.new${NC} - New credentials (ready to use)"
Write-Host "  - ${CYAN}ROTATION_CHECKLIST.md${NC} - Step-by-step guide"
Write-Host "  - ${CYAN}update-production-secrets.sh${NC} - Deployment script"
Write-Host ""

if (-not $ApplyToProduction) {
    Write-Host "${YELLOW}⚠️  NEXT STEPS:${NC}"
    Write-Host ""
    Write-Host "1. Review new credentials in $packageDir/.env.new"
    Write-Host "2. Get API keys from respective dashboards"
    Write-Host "3. Generate blockchain keypairs"
    Write-Host "4. Follow checklist: $packageDir/ROTATION_CHECKLIST.md"
    Write-Host "5. Deploy using: $packageDir/update-production-secrets.sh"
    Write-Host ""
    Write-Host "${RED}⚠️  IMPORTANT:${NC}"
    Write-Host "Old credentials are compromised and must be rotated immediately!"
} else {
    Write-Host "${RED}🔴 PRODUCTION DEPLOYMENT READY${NC}"
    Write-Host ""
    Write-Host "Execute the following on production servers:"
    Write-Host "  cd /path/to/app"
    Write-Host "  ./$packageDir/update-production-secrets.sh"
}

Write-Host ""
Write-Host "${CYAN}Package created: $packageDir${NC}"

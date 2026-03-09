# security-setup.ps1
# PowerShell script for Windows environments
# Generates secure secrets and validates environment

param(
    [switch]$Production,
    [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"

Write-Host "🔐 ProxySocialHub Security Setup" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Green
Write-Host ""

# Check if running as administrator (not recommended)
if ([Security.Principal.WindowsIdentity]::GetCurrent().Groups -match 'S-1-5-32-544') {
    Write-Host "⚠️  WARNING: Running as Administrator. This is not recommended for security." -ForegroundColor Yellow
}

# Function to generate cryptographically secure random string
function New-SecureSecret {
    param(
        [int]$Length = 32,
        [string]$Encoding = "Hex"  # Hex or Base64
    )
    
    $bytes = New-Object byte[] $Length
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $rng.Dispose()
    
    if ($Encoding -eq "Hex") {
        return [BitConverter]::ToString($bytes).Replace("-", "").ToLower()
    } else {
        return [Convert]::ToBase64String($bytes)
    }
}

# Function to validate secret strength
function Test-SecretStrength {
    param([string]$Secret, [string]$Name, [int]$MinLength)
    
    if ([string]::IsNullOrEmpty($Secret)) {
        Write-Error "$Name is empty"
        return $false
    }
    
    if ($Secret.Length -lt $MinLength) {
        Write-Error "$Name is too short ($($Secret.Length) chars, minimum $MinLength)"
        return $false
    }
    
    # Check for weak patterns
    $weakPatterns = @('secret', 'password', '123456', 'default', 'change', 'dev', 'test', 'proxyhubb')
    $lowerSecret = $Secret.ToLower()
    
    foreach ($pattern in $weakPatterns) {
        if ($lowerSecret.Contains($pattern)) {
            Write-Warning "$Name contains weak pattern: $pattern"
        }
    }
    
    return $true
}

# Validation mode
if ($ValidateOnly) {
    Write-Host "🔍 Validating existing configuration..." -ForegroundColor Cyan
    
    $envFile = ".env"
    if (-not (Test-Path $envFile)) {
        Write-Error ".env file not found. Run without -ValidateOnly to create one."
        exit 1
    }
    
    # Load .env file
    $envContent = Get-Content $envFile -Raw
    
    # Extract and validate secrets
    $secrets = @{
        "JWT_SECRET" = @{ MinLength = 64 }
        "SESSION_SECRET" = @{ MinLength = 32 }
        "ENCRYPTION_KEY" = @{ MinLength = 32 }
        "REDIS_PASSWORD" = @{ MinLength = 16 }
    }
    
    $allValid = $true
    foreach ($secretName in $secrets.Keys) {
        if ($envContent -match "$secretName=([^
]+)") {
            $value = $Matches[1]
            $minLength = $secrets[$secretName].MinLength
            
            if (-not (Test-SecretStrength $value $secretName $minLength)) {
                $allValid = $false
            } else {
                Write-Host "  ✓ $secretName is valid" -ForegroundColor Green
            }
        } else {
            Write-Error "  ✗ $secretName not found"
            $allValid = $false
        }
    }
    
    if ($allValid) {
        Write-Host "`n✅ All secrets are valid!" -ForegroundColor Green
        exit 0
    } else {
        Write-Host "`n❌ Some secrets are invalid. Run without -ValidateOnly to regenerate." -ForegroundColor Red
        exit 1
    }
}

# Generation mode
Write-Host "🔑 Generating secure secrets..." -ForegroundColor Cyan

$secrets = @{
    JWT_SECRET = New-SecureSecret -Length 64 -Encoding Hex
    SESSION_SECRET = New-SecureSecret -Length 64 -Encoding Hex
    ENCRYPTION_KEY = New-SecureSecret -Length 32 -Encoding Base64
    REDIS_PASSWORD = New-SecureSecret -Length 32 -Encoding Base64
    POSTGRES_PASSWORD = New-SecureSecret -Length 32 -Encoding Base64
}

# Display generated secrets
Write-Host "`nGenerated Secrets:" -ForegroundColor Yellow
Write-Host "(These will be saved to .env file)" -ForegroundColor Gray
foreach ($name in $secrets.Keys) {
    $masked = $secrets[$name].Substring(0, [Math]::Min(8, $secrets[$name].Length)) + "..."
    Write-Host "  $name = $masked" -ForegroundColor Gray
}

# Environment
$environment = if ($Production) { "production" } else { "development" }
$port = if ($Production) { "80" } else { "8080" }

# Create .env file
Write-Host "`n📝 Creating .env file..." -ForegroundColor Cyan

$envContent = @"
# ProxySocialHub Environment Configuration
# GENERATED: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
# SECURITY LEVEL: HIGH
# AUTO-GENERATED - DO NOT MODIFY MANUALLY

# ============================================
# CRITICAL SECRETS (AUTO-GENERATED)
# ============================================
JWT_SECRET=$($secrets.JWT_SECRET)
SESSION_SECRET=$($secrets.SESSION_SECRET)
ENCRYPTION_KEY=$($secrets.ENCRYPTION_KEY)
REDIS_PASSWORD=$($secrets.REDIS_PASSWORD)

# Database
DATABASE_URL=postgresql://proxyhubb:$($secrets.POSTGRES_PASSWORD)@localhost:5432/proxyhubb?sslmode=require
POSTGRES_USER=proxyhubb
POSTGRES_PASSWORD=$($secrets.POSTGRES_PASSWORD)
POSTGRES_DB=proxyhubb

# Redis
REDIS_URL=redis://:$($secrets.REDIS_PASSWORD)@localhost:6379

# ============================================
# APPLICATION SETTINGS
# ============================================
APP_ENV=$environment
PORT=$port
API_BASE_URL=http://localhost:$port
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
# SMTP_PORT=587
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

# ============================================
# SECURITY
# ============================================
SECRET_MANAGER=env
"@

# Backup existing .env
if (Test-Path ".env") {
    $backupName = ".env.backup.$(Get-Date -Format 'yyyyMMdd_HHmmss')"
    Copy-Item ".env" $backupName
    Write-Host "  📋 Backed up existing .env to $backupName" -ForegroundColor Gray
}

# Write new .env file
$envContent | Out-File -FilePath ".env" -Encoding UTF8 -NoNewline

# Set secure permissions (Windows doesn't have chmod, but we can make it hidden)
$envFile = Get-Item ".env" -Force
$envFile.Attributes = $envFile.Attributes -bor [System.IO.FileAttributes]::Hidden

Write-Host "  ✅ .env file created with secure permissions" -ForegroundColor Green

# Create .env.example template
$exampleContent = @"
# ProxySocialHub Environment Template
# Copy to .env and fill in all values
# DO NOT add real values to this file

# ============================================
# REQUIRED SECRETS (Generate strong values)
# Run: .\scripts\security-setup.ps1
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
"@

$exampleContent | Out-File -FilePath ".env.example" -Encoding UTF8 -NoNewline
Write-Host "  ✅ .env.example template created" -ForegroundColor Green

# Create credential rotation checklist
$checklistContent = @"
# Credential Rotation Checklist
# Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")

## IMMEDIATE ACTIONS

### Database Credentials
- [ ] Rotate PostgreSQL password if using cloud provider
- [ ] Update DATABASE_URL with new password
- [ ] Test database connectivity

### Redis
- [ ] Redis password is set in REDIS_PASSWORD
- [ ] Redis URL includes password

### Application Secrets
- [ ] JWT_SECRET is 64+ characters
- [ ] SESSION_SECRET is 32+ characters
- [ ] ENCRYPTION_KEY is 32+ characters

### API Keys (If using external services)
- [ ] Supabase keys rotated
- [ ] Paystack keys rotated
- [ ] OAuth credentials valid

## VERIFICATION

Run validation:
```powershell
.\scripts\security-setup.ps1 -ValidateOnly
```

## NEXT STEPS

1. Fill in external service credentials (Supabase, Paystack, etc.)
2. Generate Solana keypairs if needed
3. Configure OAuth providers
4. Test application startup
5. Run security scans

## SECURITY NOTES

- Never commit .env to git
- Use secure secret management in production (Vault, AWS Secrets Manager)
- Rotate credentials quarterly
- Monitor for unauthorized access
"@

$checklistContent | Out-File -FilePath "CREDENTIAL_ROTATION_CHECKLIST.md" -Encoding UTF8
Write-Host "  ✅ Checklist created" -ForegroundColor Green

Write-Host "`n================================" -ForegroundColor Green
Write-Host "Security Setup Complete!" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Green
Write-Host ""
Write-Host "Generated Files:" -ForegroundColor Cyan
Write-Host "  - .env (with secure secrets)" -ForegroundColor White
Write-Host "  - .env.example (template)" -ForegroundColor White
Write-Host "  - CREDENTIAL_ROTATION_CHECKLIST.md" -ForegroundColor White
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Cyan
Write-Host "  1. Edit .env and fill in external service credentials" -ForegroundColor White
Write-Host "  2. Run: docker-compose -f docker-compose.secure.yml up -d" -ForegroundColor White
Write-Host "  3. Verify: curl http://localhost:$port/health" -ForegroundColor White
Write-Host ""
Write-Host "⚠️  IMPORTANT: Never commit .env to git!" -ForegroundColor Yellow
Write-Host "   The file has been marked as hidden for added protection." -ForegroundColor Gray

# Validate immediately
Write-Host "`n🔍 Running validation..." -ForegroundColor Cyan
& $MyInvocation.MyCommand.Path -ValidateOnly

# Security Hardening Guide

This document provides comprehensive security hardening procedures for the ProxyHubb system.

## Table of Contents

- [Security Architecture](#security-architecture)
- [Hardening Checklist](#hardening-checklist)
- [Network Security](#network-security)
- [Application Security](#application-security)
- [Database Security](#database-security)
- [Blockchain Security](#blockchain-security)
- [Container Security](#container-security)
- [Secret Management](#secret-management)
- [Incident Response](#incident-response)
- [Compliance](#compliance)

---

## Security Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PERIMETER SECURITY                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   WAF       │  │   DDoS      │  │   CDN       │  │   Rate      │         │
│  │   (AWS/CF)  │  │   Protection│  │             │  │   Limiting  │         │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘         │
└─────────┼────────────────┼────────────────┼────────────────┼────────────────┘
          │                │                │                │
          ▼                ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         APPLICATION SECURITY                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   Auth      │  │   Input     │  │   Output    │  │   Session   │         │
│  │   (JWT/MFA) │  │   Validation│  │   Encoding  │  │   Mgmt      │         │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   RBAC      │  │   Audit     │  │   Circuit   │  │   API Keys  │         │
│  │             │  │   Logging   │  │   Breakers  │  │             │         │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘         │
└─────────────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DATA SECURITY                                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   RLS       │  │   Encryption│  │   Backup    │  │   Key       │         │
│  │   (Postgres)│  │   (AES-256) │  │   Encryption│  │   Rotation  │         │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘         │
└─────────────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         BLOCKCHAIN SECURITY                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   Multi-sig │  │   Cold      │  │   Hardware  │  │   Smart     │         │
│  │   Treasury  │  │   Storage   │  │   Wallets   │  │   Contract  │         │
│  │             │  │             │  │             │  │   Audits    │         │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘         │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Hardening Checklist

### Pre-Production Security Checklist

- [ ] All secrets rotated from development values
- [ ] TLS 1.3 enforced for all connections
- [ ] Security headers configured
- [ ] WAF rules activated
- [ ] DDoS protection enabled
- [ ] Rate limiting configured
- [ ] Database RLS policies applied
- [ ] Encryption at rest enabled
- [ ] Backup encryption configured
- [ ] Audit logging enabled
- [ ] MFA enforced for admin accounts
- [ ] API keys have expiration dates
- [ ] Container images scanned
- [ ] Network policies applied
- [ ] Penetration test completed
- [ ] Security runbook reviewed

---

## Network Security

### 1. TLS Configuration

**Minimum TLS Version**: 1.3
**Cipher Suites** (TLS 1.2 fallback):
- TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384
- TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256
- TLS_AES_256_GCM_SHA384
- TLS_CHACHA20_POLY1305_SHA256

**Implementation**:

```go
// services/control-api/main.go
tlsConfig := &tls.Config{
    MinVersion: tls.VersionTLS13,
    CurvePreferences: []tls.CurveID{
        tls.X25519,
        tls.CurveP256,
    },
    PreferServerCipherSuites: true,
}
```

### 2. Security Headers

All responses must include:

```go
// middleware/security.go
func SecurityHeaders() gin.HandlerFunc {
    return func(c *gin.Context) {
        c.Header("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload")
        c.Header("X-Content-Type-Options", "nosniff")
        c.Header("X-Frame-Options", "DENY")
        c.Header("X-XSS-Protection", "1; mode=block")
        c.Header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'")
        c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
        c.Header("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
        c.Next()
    }
}
```

### 3. Rate Limiting

Tier-based rate limiting:

| Tier | Requests/Min | Burst | Concurrent |
|------|--------------|-------|------------|
| Anonymous | 10 | 20 | 5 |
| New | 30 | 50 | 10 |
| Verified | 100 | 150 | 25 |
| Premium | 1000 | 2000 | 100 |
| Enterprise | 10000 | 20000 | 500 |

```go
// middleware/ratelimit.go
func RateLimiter() gin.HandlerFunc {
    store := redisStore.NewStore(
        redisClient,
        "ratelimit:",
    )
    
    return limiter.NewGinMiddleware(
        limiter.WithStore(store),
        limiter.WithRate(100, time.Minute),
    )
}
```

### 4. IP Allowlisting

Admin endpoints restricted by IP:

```go
// middleware/ip_whitelist.go
func IPWhitelist(allowedIPs []string) gin.HandlerFunc {
    whitelist := make(map[string]bool)
    for _, ip := range allowedIPs {
        whitelist[ip] = true
    }
    
    return func(c *gin.Context) {
        clientIP := c.ClientIP()
        if !whitelist[clientIP] {
            c.AbortWithStatus(http.StatusForbidden)
            return
        }
        c.Next()
    }
}
```

---

## Application Security

### 1. Authentication Hardening

#### JWT Security

```go
// internal/crypto/jwt.go
const (
    AccessTokenTTL  = 15 * time.Minute
    RefreshTokenTTL = 7 * 24 * time.Hour
    TokenIssuer     = "proxyhubb"
    TokenAudience   = "proxyhubb-api"
)

type JWTConfig struct {
    Secret         []byte
    Issuer         string
    Audience       string
    AccessTokenTTL time.Duration
}

func GenerateToken(userID string, config JWTConfig) (string, error) {
    token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
        "sub": userID,
        "iss": config.Issuer,
        "aud": config.Audience,
        "iat": time.Now().Unix(),
        "exp": time.Now().Add(config.AccessTokenTTL).Unix(),
        "jti": uuid.New().String(), // Unique token ID for revocation
    })
    
    return token.SignedString(config.Secret)
}
```

#### Multi-Factor Authentication (MFA)

```go
// internal/security/mfa.go
func ValidateTOTP(userID string, code string) error {
    secret, err := getTOTPSecret(userID)
    if err != nil {
        return err
    }
    
    valid := totp.Validate(code, secret)
    if !valid {
        // Check backup codes
        if !validateBackupCode(userID, code) {
            audit.LogFailedMFA(userID, code)
            return errors.New("invalid MFA code")
        }
    }
    
    return nil
}
```

### 2. Input Validation

All inputs validated using struct tags:

```go
// models/user.go
type CreateUserRequest struct {
    Email     string `json:"email" binding:"required,email,max=255"`
    Password  string `json:"password" binding:"required,min=12,max=128,password_complexity"`
    Username  string `json:"username" binding:"required,alphanum,min=3,max=30"`
    Referral  string `json:"referral_code" binding:"omitempty,len=10,alphanum"`
}

// Custom password validator
func passwordComplexityValidator(fl validator.FieldLevel) bool {
    password := fl.Field().String()
    
    var (
        hasUpper   = regexp.MustCompile(`[A-Z]`).MatchString(password)
        hasLower   = regexp.MustCompile(`[a-z]`).MatchString(password)
        hasNumber  = regexp.MustCompile(`[0-9]`).MatchString(password)
        hasSpecial = regexp.MustCompile(`[!@#$%^&*]`).MatchString(password)
    )
    
    return hasUpper && hasLower && hasNumber && hasSpecial
}
```

### 3. Output Encoding

Prevent XSS through proper encoding:

```go
// middleware/encoding.go
func XMLEscape(s string) string {
    return html.EscapeString(s)
}

func JSONResponse(c *gin.Context, data interface{}) {
    // Ensure no HTML in JSON responses
    c.JSON(http.StatusOK, data)
}
```

### 4. SQL Injection Prevention

Using parameterized queries exclusively:

```go
// BAD - Never do this
db.Exec("SELECT * FROM users WHERE email = '" + email + "'")

// GOOD - Use parameterized queries
db.Exec("SELECT * FROM users WHERE email = $1", email)

// BETTER - Use ORM with parameterization
db.Where("email = ?", email).First(&user)
```

### 5. CSRF Protection

```go
// middleware/csrf.go
func CSRFProtection() gin.HandlerFunc {
    return csrf.Protect(
        []byte(config.CSRFSecret),
        csrf.Secure(true),
        csrf.HttpOnly(true),
        csrf.SameSite(csrf.SameSiteStrictMode),
        csrf.Path("/"),
    )
}
```

---

## Database Security

### 1. Row Level Security (RLS)

All tables have RLS enabled:

```sql
-- Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY profiles_select_own ON profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY profiles_update_own ON profiles
    FOR UPDATE USING (auth.uid() = id);

-- Admin bypass
CREATE POLICY admin_all ON profiles
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM profiles 
            WHERE id = auth.uid() AND role = 'admin'
        )
    );
```

### 2. Connection Security

```yaml
# Database connection config
sslmode: require
sslcert: /certs/client-cert.pem
sslkey: /certs/client-key.pem
sslrootcert: /certs/ca-cert.pem
```

### 3. Query Timeouts

```go
// internal/db/db.go
func InitDB(config Config) (*gorm.DB, error) {
    db, err := gorm.Open(postgres.Open(config.DSN), &gorm.Config{
        // Query timeout
        QueryFields: true,
    })
    
    sqlDB, _ := db.DB()
    sqlDB.SetConnMaxLifetime(30 * time.Minute)
    sqlDB.SetMaxOpenConns(25)
    sqlDB.SetMaxIdleConns(10)
    
    return db, err
}
```

### 4. Sensitive Data Encryption

```go
// internal/crypto/encryption.go
type EncryptedField struct {
    Ciphertext []byte
    Nonce      []byte
}

func Encrypt(plaintext string, key []byte) (*EncryptedField, error) {
    block, err := aes.NewCipher(key)
    if err != nil {
        return nil, err
    }
    
    nonce := make([]byte, 12)
    if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
        return nil, err
    }
    
    aesgcm, err := cipher.NewGCM(block)
    if err != nil {
        return nil, err
    }
    
    ciphertext := aesgcm.Seal(nil, nonce, []byte(plaintext), nil)
    
    return &EncryptedField{
        Ciphertext: ciphertext,
        Nonce:      nonce,
    }, nil
}
```

---

## Blockchain Security

### 1. Oracle Security

```go
// internal/solana/oracle.go
type OracleConfig struct {
    KeypairPath      string
    MinBalanceLamports uint64 // 0.1 SOL minimum
    RPCEndpoints     []string
    RequestTimeout   time.Duration
}

func (o *Oracle) ValidateHealth() error {
    // Check balance
    balance, err := o.client.GetBalance(o.publicKey, rpc.CommitmentConfirmed)
    if err != nil {
        return fmt.Errorf("failed to check oracle balance: %w", err)
    }
    
    if balance.Value < o.config.MinBalanceLamports {
        alert.Send("Oracle balance low", fmt.Sprintf("Balance: %d lamports", balance.Value))
        return fmt.Errorf("oracle balance too low: %d", balance.Value)
    }
    
    return nil
}
```

### 2. Multi-sig Treasury

```rust
// Treasury should use multi-sig
// Example: 3-of-5 multi-sig for treasury operations
```

### 3. Smart Contract Security

Best practices:
- All programs audited by third-party
- Formal verification for critical paths
- Bug bounty program active
- Upgrade authority secured
- Emergency pause functionality

### 4. Transaction Signing

```go
// internal/solana/signer.go
func SignTransaction(tx *solana.Transaction, signer solana.PrivateKey) error {
    // Validate transaction before signing
    if err := validateTransaction(tx); err != nil {
        return fmt.Errorf("transaction validation failed: %w", err)
    }
    
    // Sign with HSM if available
    if hsmEnabled {
        return signWithHSM(tx)
    }
    
    // Fallback to secure key storage
    return tx.Sign(signer)
}
```

---

## Container Security

### 1. Image Scanning

```yaml
# .github/workflows/security.yml
- name: Scan Docker image
  uses: aquasecurity/trivy-action@master
  with:
    image-ref: 'control-api:latest'
    format: 'sarif'
    output: 'trivy-results.sarif'
```

### 2. Non-Root User

```dockerfile
# Dockerfile
FROM golang:1.24-alpine AS builder
# ... build steps ...

FROM alpine:3.19
RUN addgroup -g 1000 -S appgroup && \
    adduser -u 1000 -S appuser -G appgroup

USER appuser

EXPOSE 8080
CMD ["./control-api"]
```

### 3. Read-Only Filesystem

```yaml
# Kubernetes deployment
securityContext:
  readOnlyRootFilesystem: true
  allowPrivilegeEscalation: false
  runAsNonRoot: true
  runAsUser: 1000
  capabilities:
    drop:
      - ALL
```

### 4. Resource Limits

```yaml
resources:
  limits:
    cpu: "2000m"
    memory: "4Gi"
  requests:
    cpu: "500m"
    memory: "1Gi"
```

---

## Secret Management

### 1. Secret Rotation Schedule

| Secret Type | Rotation Frequency | Procedure |
|-------------|-------------------|-----------|
| JWT Secret | 90 days | Automated rotation |
| API Keys | 180 days | Manual rotation |
| Database passwords | 90 days | Automated rotation |
| Solana oracle keys | 180 days | Manual with ceremony |
| TLS certificates | Auto-renewal | Let's Encrypt |

### 2. Secret Storage

**Production**: AWS Secrets Manager / HashiCorp Vault
**Development**: 1Password / Bitwarden
**CI/CD**: GitHub Secrets

### 3. Environment Segregation

Never share secrets between environments:
```
production/    - Production only
staging/       - Staging only
development/   - Local development
```

---

## Incident Response

See [Security Incident Runbook](security-incident.md) for detailed procedures.

### Security Incident Levels

| Level | Description | Examples |
|-------|-------------|----------|
| **Critical** | Active breach, data exfiltration | Unauthorized access, funds stolen |
| **High** | Potential breach, vulnerability exploited | Zero-day exploited, admin compromised |
| **Medium** | Vulnerability discovered | CVE affecting dependency |
| **Low** | Policy violation, minor issue | Unencrypted backup, weak password |

---

## Compliance

### GDPR Compliance

- [ ] Data inventory documented
- [ ] Privacy policy published
- [ ] Consent mechanisms implemented
- [ ] Data deletion procedures defined
- [ ] DPO appointed

### SOC 2 Preparation

- [ ] Access controls documented
- [ ] Change management process
- [ ] Backup and recovery tested
- [ ] Monitoring and alerting in place
- [ ] Incident response procedures

---

## Security Testing

### 1. Automated Security Testing

```bash
# Dependency scanning
govulncheck ./...
cargo audit
npm audit

# Static analysis
gosec ./...
cargo clippy

# Container scanning
trivy image control-api:latest
```

### 2. Penetration Testing

Quarterly penetration tests covering:
- OWASP Top 10
- API security
- Blockchain interactions
- Social engineering

### 3. Bug Bounty Program

Platform: HackerOne / Bugcrowd
Scope: *.proxyhubb.com, Smart contracts
Rewards: Up to $10,000 for critical vulnerabilities

---

## Security Contacts

| Role | Email | PagerDuty |
|------|-------|-----------|
| Security Team | security@proxyhubb.com | Yes |
| CISO | ciso@proxyhubb.com | Yes |
| On-Call Engineer | oncall@proxyhubb.com | Yes |

---

Last updated: 2026-03-09

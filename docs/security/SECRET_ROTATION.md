# Secret Rotation Procedures

This document provides procedures for rotating all types of secrets in the ProxyHubb system.

## Table of Contents

- [Rotation Schedule](#rotation-schedule)
- [Pre-Rotation Checklist](#pre-rotation-checklist)
- [JWT Secret Rotation](#jwt-secret-rotation)
- [Database Credentials Rotation](#database-credentials-rotation)
- [API Key Rotation](#api-key-rotation)
- [Solana Oracle Key Rotation](#solana-oracle-key-rotation)
- [TLS Certificate Rotation](#tls-certificate-rotation)
- [Emergency Rotation](#emergency-rotation)
- [Verification](#verification)

---

## Rotation Schedule

| Secret Type | Frequency | Method | Downtime |
|-------------|-----------|--------|----------|
| JWT Secret | 90 days | Zero-downtime | None |
| Database Password | 90 days | Rolling update | < 1 min |
| API Keys | 180 days | Graceful expiration | None |
| Solana Oracle Key | 180 days | Ceremony | 5 min |
| Session Secret | 90 days | Rolling update | None |
| Encryption Key | 365 days | Re-encryption required | Planned window |
| TLS Certificates | Auto (90 days) | Let's Encrypt | None |
| Redis Password | 90 days | Rolling update | < 1 min |

---

## Pre-Rotation Checklist

Before rotating any secret:

- [ ] Maintenance window scheduled (if required)
- [ ] Team notified via #deployments
- [ ] Backup of current secrets (encrypted)
- [ ] Rollback procedure documented
- [ ] Monitoring alerts configured
- [ ] On-call engineer available

---

## JWT Secret Rotation

### Overview
Zero-downtime rotation using key versioning.

### Procedure

```bash
#!/bin/bash
# scripts/rotate-jwt-secret.sh

set -e

echo "=== JWT Secret Rotation ==="

# 1. Generate new secret
NEW_SECRET=$(openssl rand -base64 64)

# 2. Add new secret to key ring (supports multiple keys)
kubectl create secret generic jwt-secret-v2 \
  --from-literal=secret="$NEW_SECRET" \
  --namespace production \
  --dry-run=client -o yaml | kubectl apply -f -

# 3. Update deployment to accept both old and new secrets
kubectl patch deployment control-api -p '{
  "spec": {
    "template": {
      "spec": {
        "containers": [{
          "name": "control-api",
          "env": [
            {
              "name": "JWT_SECRET",
              "valueFrom": {
                "secretKeyRef": {
                  "name": "jwt-secret-v2",
                  "key": "secret"
                }
              }
            },
            {
              "name": "JWT_SECRET_OLD",
              "valueFrom": {
                "secretKeyRef": {
                  "name": "jwt-secret",
                  "key": "secret"
                }
              }
            }
          ]
        }]
      }
    }
  }
}'

# 4. Wait for rollout
kubectl rollout status deployment/control-api

# 5. Verify new tokens work
NEW_TOKEN=$(curl -s -X POST https://api.proxyhubb.com/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test"}' | jq -r '.access_token')

curl -s https://api.proxyhubb.com/v1/sessions \
  -H "Authorization: Bearer $NEW_TOKEN" | jq '.'

# 6. After 24 hours (old tokens expired), remove old secret
# kubectl delete secret jwt-secret
# kubectl patch deployment control-api --type=json -p='[{"op": "remove", "path": "/spec/template/spec/containers/0/env/1"}]'

echo "=== JWT Secret Rotation Complete ==="
```

### Verification

```bash
# Check token validation
curl -s https://api.proxyhubb.com/v1/auth/verify \
  -H "Authorization: Bearer $NEW_TOKEN"

# Verify old tokens are rejected (after grace period)
curl -s https://api.proxyhubb.com/v1/sessions \
  -H "Authorization: Bearer $OLD_TOKEN" \
  -w "HTTP Status: %{http_code}\n"
# Expected: HTTP Status: 401
```

---

## Database Credentials Rotation

### Overview
PostgreSQL password rotation with connection pool draining.

### Procedure

```bash
#!/bin/bash
# scripts/rotate-db-credentials.sh

set -e

echo "=== Database Credentials Rotation ==="

# 1. Generate new password
NEW_PASSWORD=$(openssl rand -base64 32)

# 2. Create new database user (PostgreSQL supports multiple users)
psql $DATABASE_URL -c "CREATE USER proxyhubb_new WITH PASSWORD '$NEW_PASSWORD';"
psql $DATABASE_URL -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO proxyhubb_new;"
psql $DATABASE_URL -c "GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO proxyhubb_new;"

# 3. Update connection string
NEW_DATABASE_URL="postgresql://proxyhubb_new:${NEW_PASSWORD}@host:5432/proxyhubb"

# 4. Create new secret
kubectl create secret generic db-credentials-v2 \
  --from-literal=url="$NEW_DATABASE_URL" \
  --namespace production \
  --dry-run=client -o yaml | kubectl apply -f -

# 5. Rolling update to use new credentials
kubectl set env deployment/control-api \
  DATABASE_URL_SECRET=db-credentials-v2 \
  --namespace production

# 6. Wait for rollout
kubectl rollout status deployment/control-api

# 7. Verify connectivity
kubectl exec -it deployment/control-api -- \
  psql $NEW_DATABASE_URL -c "SELECT 1;"

# 8. After 1 hour, remove old user
# psql $DATABASE_URL -c "REASSIGN OWNED BY proxyhubb_old TO proxyhubb_new;"
# psql $DATABASE_URL -c "DROP USER proxyhubb_old;"

echo "=== Database Credentials Rotation Complete ==="
```

### Rollback

```bash
# If issues detected, rollback to previous secret
kubectl set env deployment/control-api \
  DATABASE_URL_SECRET=db-credentials \
  --namespace production

kubectl rollout status deployment/control-api
```

---

## API Key Rotation

### Overview
Graceful API key rotation with overlap period.

### Procedure

```go
// internal/api/apikeys.go
func RotateAPIKey(userID string) (*APIKey, error) {
    // 1. Generate new key
    newKey, err := generateSecureAPIKey()
    if err != nil {
        return nil, err
    }
    
    // 2. Store new key with creation time
    apiKey := &APIKey{
        UserID:    userID,
        Key:       hashKey(newKey),
        Plaintext: newKey, // Return once to user
        CreatedAt: time.Now(),
        ExpiresAt: time.Now().Add(180 * 24 * time.Hour),
        Status:    "active",
    }
    
    if err := db.Create(apiKey).Error; err != nil {
        return nil, err
    }
    
    // 3. Schedule old key expiration (30 days grace period)
    oldKey, err := getCurrentAPIKey(userID)
    if err == nil {
        oldKey.ExpiresAt = time.Now().Add(30 * 24 * time.Hour)
        db.Save(oldKey)
        
        // Notify user
        email.SendAPIKeyRotated(userID, oldKey.ExpiresAt)
    }
    
    return apiKey, nil
}
```

### User Notification

```bash
# Notify users with expiring keys via comms workflow (admin API removed)
./scripts/security/send-key-expiry-notices.sh --days 7 --channel email
```

---

## Solana Oracle Key Rotation

### Overview
High-security rotation ceremony for blockchain oracle.

### Prerequisites

- [ ] 3 team members present (minimum)
- [ ] Hardware security modules (HSMs) available
- [ ] Solana devnet tested
- [ ] Emergency procedures reviewed

### Procedure

```bash
#!/bin/bash
# scripts/rotate-solana-oracle.sh

set -e

echo "=== Solana Oracle Key Rotation Ceremony ==="
echo "Date: $(date)"
echo "Participants: $PARTICIPANTS"

# 1. Generate new keypair (air-gapped machine recommended)
solana-keygen new --outfile /secure/oracle-keypair-new.json --no-passphrase

NEW_PUBKEY=$(solana-keygen pubkey /secure/oracle-keypair-new.json)
echo "New Oracle Public Key: $NEW_PUBKEY"

# 2. Fund new oracle account
solana transfer $NEW_PUBKEY 0.1 \
  --from /secure/treasury-keypair.json \
  --url https://api.mainnet-beta.solana.com

# 3. Update on-chain program to recognize new oracle
# This requires multi-sig or admin key
solana program deploy \
  --program-id $PROGRAM_ID \
  --upgrade-authority /secure/admin-keypair.json \
  # Include new oracle in authorized signers

# 4. Update Kubernetes secret
kubectl create secret generic solana-oracle-v2 \
  --from-file=keypair=/secure/oracle-keypair-new.json \
  --namespace production \
  --dry-run=client -o yaml | kubectl apply -f -

# 5. Rolling update
kubectl set env deployment/control-api \
  SOLANA_ORACLE_KEYPAIR_SECRET=solana-oracle-v2 \
  --namespace production

kubectl rollout status deployment/control-api

# 6. Test oracle functionality
curl -X POST https://api.proxyhubb.com/v1/solana/test-oracle \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# 7. Revoke old oracle permissions (after 24h confirmation)
# solana program update-authority ...

echo "=== Oracle Key Rotation Complete ==="
echo "Old key can be destroyed after 7 days"
```

### Security Considerations

1. **Key Generation**: Performed on air-gapped machine
2. **Storage**: Hardware security module (HSM) or AWS KMS
3. **Access**: Multi-sig required for rotation
4. **Backup**: Encrypted backup in secure physical location
5. **Destruction**: Old keys securely wiped after grace period

---

## TLS Certificate Rotation

### Overview
Automated Let's Encrypt certificate renewal.

### Auto-Renewal (Cert-Manager)

```yaml
# infra/k8s/cert-manager/certificate.yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: proxyhubb-tls
  namespace: production
spec:
  secretName: proxyhubb-tls-secret
  issuerRef:
    name: letsencrypt-prod
    kind: ClusterIssuer
  dnsNames:
    - api.proxyhubb.com
    - app.proxyhubb.com
    - gateway.proxyhubb.com
```

### Manual Rotation

```bash
# If using custom certificates
# 1. Obtain new certificate from CA
# 2. Update secret
kubectl create secret tls proxyhubb-tls \
  --cert=new-cert.pem \
  --key=new-key.pem \
  --namespace production \
  --dry-run=client -o yaml | kubectl apply -f -

# 3. Reload ingress
kubectl rollout restart deployment ingress-nginx -n ingress-nginx
```

### Certificate Monitoring

```bash
# Check certificate expiry
echo | openssl s_client -servername api.proxyhubb.com \
  -connect api.proxyhubb.com:443 2>/dev/null | \
  openssl x509 -noout -dates

# Alert if expiring within 30 days
EXPIRY=$(echo | openssl s_client -servername api.proxyhubb.com \
  -connect api.proxyhubb.com:443 2>/dev/null | \
  openssl x509 -noout -enddate | cut -d= -f2)
EXPIRY_EPOCH=$(date -d "$EXPIRY" +%s)
CURRENT_EPOCH=$(date +%s)
DAYS_UNTIL_EXPIRY=$(( (EXPIRY_EPOCH - CURRENT_EPOCH) / 86400 ))

if [ $DAYS_UNTIL_EXPIRY -lt 30 ]; then
  alert "Certificate expiring in $DAYS_UNTIL_EXPIRY days"
fi
```

---

## Emergency Rotation

### Compromised Secret Response

```bash
#!/bin/bash
# scripts/emergency-rotation.sh

SECRET_TYPE=$1

echo "!!! EMERGENCY SECRET ROTATION !!!"
echo "Type: $SECRET_TYPE"
echo "Time: $(date)"
echo "Initiated by: $USER"

case $SECRET_TYPE in
  "jwt")
    ./scripts/rotate-jwt-secret.sh
    ;;
  "database")
    ./scripts/rotate-db-credentials.sh
    ;;
  "solana-oracle")
    ./scripts/rotate-solana-oracle.sh
    ;;
  "all")
    ./scripts/rotate-jwt-secret.sh
    ./scripts/rotate-db-credentials.sh
    ./scripts/rotate-api-keys.sh
    # Oracle requires manual ceremony
    echo "Solana oracle requires manual rotation ceremony"
    ;;
  *)
    echo "Unknown secret type: $SECRET_TYPE"
    exit 1
    ;;
esac

# Notify security team
slack-notify "#security" "Emergency rotation completed for: $SECRET_TYPE"

# Force logout all users
redis-cli FLUSHDB

echo "!!! EMERGENCY ROTATION COMPLETE !!!"
```

### Incident Response

1. **Detect**: Monitoring alert or external report
2. **Contain**: Rotate compromised secret immediately
3. **Assess**: Review access logs for unauthorized usage
4. **Notify**: Inform affected users if data exposed
5. **Document**: Post-mortem within 24 hours

---

## Verification

### Post-Rotation Checklist

- [ ] New secret active in production
- [ ] Services using new secret operational
- [ ] Old secret invalidated (where applicable)
- [ ] Monitoring shows normal metrics
- [ ] No increase in error rates
- [ ] Authentication working correctly
- [ ] Database connections successful
- [ ] Blockchain transactions signing properly

### Automated Verification

```bash
# Run verification suite
./scripts/verify-secrets.sh
```

```bash
#!/bin/bash
# scripts/verify-secrets.sh

set -e

echo "=== Secret Verification ==="

# Test JWT
JWT_TEST=$(curl -s -X POST https://api.proxyhubb.com/v1/auth/login \
  -d '{"email":"test@proxyhubb.com","password":"test"}' | jq -r '.access_token')

if [ "$JWT_TEST" == "null" ] || [ -z "$JWT_TEST" ]; then
  echo "ERROR: JWT authentication failed"
  exit 1
fi
echo "✓ JWT working"

# Test Database
curl -s https://api.proxyhubb.com/v1/health/db | grep -q "ok"
if [ $? -ne 0 ]; then
  echo "ERROR: Database connection failed"
  exit 1
fi
echo "✓ Database connection working"

# Test Solana Oracle
curl -s https://api.proxyhubb.com/v1/solana/oracle/health | grep -q "healthy"
if [ $? -ne 0 ]; then
  echo "ERROR: Solana oracle not healthy"
  exit 1
fi
echo "✓ Solana oracle healthy"

# Test Redis
curl -s https://api.proxyhubb.com/v1/health/cache | grep -q "ok"
if [ $? -ne 0 ]; then
  echo "ERROR: Redis connection failed"
  exit 1
fi
echo "✓ Redis connection working"

echo "=== All Secrets Verified ==="
```

---

## Record Keeping

Maintain rotation log:

```yaml
# security/rotation-log.yml
rotations:
  - date: "2026-03-09"
    type: "jwt-secret"
    initiated_by: "security-team"
    reason: "scheduled"
    old_secret_hash: "sha256:abc123..."
    new_secret_hash: "sha256:def456..."
    verification_status: "passed"
    
  - date: "2026-03-09"
    type: "database-password"
    initiated_by: "dba-team"
    reason: "scheduled"
    duration_minutes: 2
    verification_status: "passed"
```

---

Last updated: 2026-03-09

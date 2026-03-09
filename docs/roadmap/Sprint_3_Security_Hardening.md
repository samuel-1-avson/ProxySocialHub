# Sprint 3: Security Hardening

**Sprint Dates**: April 29 - May 12, 2026  
**Sprint Goal**: Implement security improvements and conduct penetration testing  
**Story Points**: 75  
**Status**: Planning

---

## Executive Summary

This sprint focuses on implementing the security hardening procedures documented in Q1. We will rotate all secrets, deploy security tools, and conduct a comprehensive penetration test.

**Critical Note**: Penetration testing is scheduled for Week 2. Reserve capacity for remediation.

---

## Sprint Backlog

### Epic: Secret Rotation (20 points)

#### Story S3.1: Rotate JWT Secrets
**Points**: 5  
**Assignee**: Security Engineer  
**Priority**: P0

**Acceptance Criteria**:
- [ ] New JWT secret generated (256-bit)
- [ ] Zero-downtime rotation completed
- [ ] Old tokens gracefully expired (24h grace period)
- [ ] All services using new secret
- [ ] Rotation logged in security audit log

**Procedure**:
```bash
# Follow docs/security/SECRET_ROTATION.md
./scripts/rotate-jwt-secret.sh --environment production

# Verify
kubectl get secrets -n production | grep jwt
```

**Rollback Plan**:
```bash
# If issues detected within 1 hour
kubectl rollout undo deployment/control-api
kubectl delete secret jwt-secret-v2
```

---

#### Story S3.2: Rotate Database Credentials
**Points**: 5  
**Assignee**: DBA / Security Engineer  
**Priority**: P0

**Acceptance Criteria**:
- [ ] New database user created
- [ ] Permissions migrated
- [ ] Connection pools updated
- [ ] Old user deactivated (after 24h)
- [ ] No connection errors

**Checklist**:
- [ ] Backup created before rotation
- [ ] New password: 32+ chars, random
- [ ] Test queries executed successfully
- [ ] Application logs: no auth failures

---

#### Story S3.3: Rotate API Keys
**Points**: 3  
**Assignee**: Backend Engineer  
**Priority**: P0

**Acceptance Criteria**:
- [ ] All admin API keys rotated
- [ ] Provider API keys notified (grace period)
- [ ] Revoked keys return 401
- [ ] Database updated

---

#### Story S3.4: Rotate Solana Oracle Keys
**Points**: 5  
**Assignee**: Blockchain Engineer + Security  
**Priority**: P0

**Acceptance Criteria**:
- [ ] New oracle keypair generated (air-gapped)
- [ ] On-chain permissions updated
- [ ] HSM configured with new key
- [ ] 48-hour monitoring period

**Security Requirements**:
- 2-person rule for key generation
- HSM storage mandatory
- Old key securely destroyed after 7 days

---

#### Story S3.5: Rotate TLS Certificates
**Points**: 2  
**Assignee**: DevOps Engineer  
**Priority**: P1

**Acceptance Criteria**:
- [ ] New certificates issued (Let's Encrypt)
- [ ] Deployed to all load balancers
- [ ] SSL Labs A+ rating maintained
- [ ] Auto-renewal verified

---

### Epic: WAF & DDoS Protection (15 points)

#### Story S3.6: Enable CloudFlare Managed Rules
**Points**: 5  
**Assignee**: DevOps / Security Engineer  
**Priority**: P0

**Acceptance Criteria**:
- [ ] OWASP Core Rule Set enabled
- [ ] Proxy-specific rules configured
- [ ] Rate limiting by tier implemented
- [ ] False positive testing completed
- [ ] Blocking > 100 attacks/day

**Rules to Enable**:
```
100173 - Anomaly:Header:User-Agent - Moderate
100202 - Anomaly:Header:Referer - Low
100300 - SQLi - High
100400 - XSS - High
100500 - LFI/RFI - High
```

---

#### Story S3.7: Configure Rate Limiting
**Points**: 5  
**Assignee**: Backend Engineer  
**Priority**: P0

**Acceptance Criteria**:
- [ ] Tier-based rate limits enforced
- [ ] Redis-backed rate limiting
- [ ] Headers returned (X-RateLimit-*)
- [ ] 429 responses working

**Implementation**:
```go
// middleware/ratelimit.go
func TierBasedRateLimiter() gin.HandlerFunc {
    return func(c *gin.Context) {
        tier := c.GetString("user_tier")
        
        limits := map[string]RateLimit{
            "new":      {Requests: 30, Window: time.Minute},
            "verified": {Requests: 100, Window: time.Minute},
            "premium":  {Requests: 1000, Window: time.Minute},
        }
        
        limit := limits[tier]
        // ... rate limiting logic
    }
}
```

---

#### Story S3.8: Deploy Security Headers
**Points**: 3  
**Assignee**: DevOps Engineer  
**Priority**: P0

**Acceptance Criteria**:
- [ ] All security headers configured
- [ ] HSTS preload ready
- [ ] CSP report-only mode (Week 1)
- [ ] CSP enforce mode (Week 2)

**Headers**:
```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=()
```

---

#### Story S3.9: IP Allowlisting for Admin
**Points**: 2  
**Assignee**: Backend Engineer  
**Priority**: P1

**Acceptance Criteria**:
- [ ] Admin endpoints IP-restricted
- [ ] VPN IPs whitelisted
- [ ] Unauthorized IPs return 403
- [ ] Audit logging for all admin access

---

### Epic: Container & Runtime Security (10 points)

#### Story S3.10: Enable Container Scanning
**Points**: 3  
**Assignee**: DevOps Engineer  
**Priority**: P0

**Acceptance Criteria**:
- [ ] Trivy scanning in CI/CD
- [ ] Block deployment on CRITICAL vulnerabilities
- [ ] Weekly scan reports
- [ ] Vulnerability database updated

**CI Integration**:
```yaml
- name: Scan Docker image
  uses: aquasecurity/trivy-action@master
  with:
    image-ref: 'control-api:${{ github.sha }}'
    exit-code: '1'
    severity: 'CRITICAL'
```

---

#### Story S3.11: Pod Security Policies
**Points**: 3  
**Assignee**: DevOps Engineer  
**Priority**: P0

**Acceptance Criteria**:
- [ ] PodSecurityPolicy applied
- [ ] Non-root containers enforced
- [ ] Read-only root filesystem
- [ ] Capability dropping

**Policy**:
```yaml
apiVersion: policy/v1beta1
kind: PodSecurityPolicy
metadata:
  name: restricted
spec:
  privileged: false
  allowPrivilegeEscalation: false
  runAsUser:
    rule: MustRunAsNonRoot
  seLinux:
    rule: RunAsAny
  fsGroup:
    rule: RunAsAny
  volumes:
  - configMap
  - secret
  - persistentVolumeClaim
```

---

#### Story S3.12: Runtime Security (Falco)
**Points**: 4  
**Assignee**: DevOps Engineer  
**Priority**: P1

**Acceptance Criteria**:
- [ ] Falco deployed
- [ ] Custom rules for suspicious activity
- [ ] Alerts to Slack
- [ ] 24-hour monitoring

---

### Epic: Penetration Testing (20 points)

#### Story S3.13: Pentest Preparation
**Points**: 5  
**Assignee**: Security Lead  
**Priority**: P0

**Acceptance Criteria**:
- [ ] Scope defined and documented
- [ ] Legal agreements signed
- [ ] Test environment prepared
- [ ] Credentials provided (test accounts)
- [ ] Emergency contact established

**Scope**:
- Web applications (app.proxyhubb.com)
- API endpoints (api.proxyhubb.com)
- Mobile app (iOS & Android)
- Smart contracts (Solana programs)
- Cloud infrastructure

**Out of Scope**:
- Physical security
- Social engineering (employees)
- Third-party vendors

---

#### Story S3.14: Penetration Testing Execution
**Points**: 8  
**Assignee**: Bishop Fox (External)  
**Priority**: P0

**Timeline**: May 6 - May 19 (2 weeks)

**Acceptance Criteria**:
- [ ] Testing completed
- [ ] Preliminary findings shared
- [ ] Critical findings reported immediately
- [ ] Final report delivered

**Daily Standup**:
- 9:00 AM with pentest team
- Review findings from previous day
- Prioritize remediation

---

#### Story S3.15: Critical Findings Remediation
**Points**: 5  
**Assignee**: All Teams  
**Priority**: P0

**Acceptance Criteria**:
- [ ] All Critical (CVSS 9.0-10.0) fixed within 24h
- [ ] All High (CVSS 7.0-8.9) fixed within 1 week
- [ ] Retest completed
- [ ] Sign-off from security team

**Process**:
1. Receive finding from pentest team
2. Triage and assign severity
3. Create ticket in security board
4. Fix and deploy
5. Request retest
6. Close ticket

---

### Epic: HSM & SIEM (10 points)

#### Story S3.16: HSM Pilot for Oracle Keys
**Points**: 5  
**Assignee**: Blockchain Engineer + Security  
**Priority**: P1

**Acceptance Criteria**:
- [ ] AWS CloudHSM provisioned
- [ ] Oracle key imported to HSM
- [ ] Signing working via HSM
- [ ] Backup and recovery tested

**Architecture**:
```
Control API → HSM Client → CloudHSM Cluster (3 nodes)
                   ↓
              Oracle Key (never leaves HSM)
```

---

#### Story S3.17: SIEM Deployment
**Points**: 3  
**Assignee**: Security Engineer  
**Priority**: P1

**Acceptance Criteria**:
- [ ] Datadog SIEM configured
- [ ] Log sources connected
- [ ] Detection rules deployed
- [ ] Dashboards created
- [ ] Alerting configured

**Data Sources**:
- Application logs
- Audit logs
- CloudTrail
- Kubernetes audit logs
- WAF logs

---

#### Story S3.18: Security Documentation Update
**Points**: 2  
**Assignee**: Security Engineer  
**Priority**: P1

**Acceptance Criteria**:
- [ ] Runbooks updated with new procedures
- [ ] Incident response playbooks created
- [ ] Security training materials prepared
- [ ] Team training session completed

---

## Sprint Schedule

### Week 1 (Apr 29 - May 5): Preparation & Implementation

| Day | Focus | Activities |
|-----|-------|------------|
| Mon | Secret Rotation | JWT, DB, API keys |
| Tue | Secret Rotation | Solana oracle keys |
| Wed | WAF/DDoS | Enable CloudFlare rules |
| Thu | Container Security | Scanning, PSPs |
| Fri | Prep | Pentest preparation |

### Week 2 (May 6-12): Penetration Testing & Remediation

| Day | Focus | Activities |
|-----|-------|------------|
| Mon | Pentest Begins | Bishop Fox starts testing |
| Tue | Pentest + Monitor | Daily findings review |
| Wed | Pentest + Remediate | Fix critical findings |
| Thu | Remediation | Continue fixes |
| Fri | Wrap-up | Final fixes, demo, retro |

---

## Vendor Coordination

### Bishop Fox (Penetration Testing)

**Contact**: pm@bishopfox.com  
**Start Date**: May 6, 2026  
**Duration**: 2 weeks  
**Cost**: $25,000

**Deliverables**:
- Daily status emails
- Immediate notification of critical findings
- Final report with CVSS scores
- Remediation guidance

**Internal Team**:
- Security Lead (primary contact)
- Backend Lead (technical questions)
- DevOps (infrastructure access)

---

## Risk Management

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Pentest finds critical vulnerability | High | Medium | Reserve 40% capacity in Week 2 |
| Secret rotation causes outage | High | Low | Test in staging first, rollback plan |
| HSM integration delays | Medium | Medium | Start early, have fallback |
| WAF false positives | Medium | Medium | Monitor closely, have bypass ready |

---

## Definition of Done

- [ ] All secrets rotated and verified
- [ ] WAF blocking attacks
- [ ] Pentest completed with findings documented
- [ ] Critical vulnerabilities fixed
- [ ] HSM storing oracle keys (if no blockers)
- [ ] SIEM collecting logs
- [ ] Team trained on new procedures
- [ ] Security score improved

---

## Success Metrics

| Metric | Before | Target | Measurement |
|--------|--------|--------|-------------|
| Security Score | TBD | A+ | Security audit |
| Critical Vulnerabilities | TBD | 0 | Pentest report |
| High Vulnerabilities | TBD | < 3 | Pentest report |
| WAF Blocks/Day | 0 | > 100 | CloudFlare analytics |
| Secrets Age | TBD | < 7 days | Audit log |

---

## Post-Sprint

### Security Audit
- [ ] Third-party security audit scheduled
- [ ] SOC 2 readiness assessment
- [ ] Bug bounty program launch preparation

---

**Sprint Master**: Security Lead  
**Product Owner**: Product Manager  
**Scrum Master**: Engineering Manager

**Last Updated**: March 9, 2026

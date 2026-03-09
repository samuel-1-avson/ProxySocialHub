# Security Incident Response Runbook

This runbook provides step-by-step procedures for handling security incidents.

## Severity Levels

| Level | Description | Response Time | Escalation |
|-------|-------------|---------------|------------|
| **Critical (SEV1)** | Active data breach, funds stolen, complete compromise | 15 min | CEO, Legal, Law Enforcement |
| **High (SEV2)** | Vulnerability exploited, unauthorized access, potential data exposure | 1 hour | CTO, Security Lead |
| **Medium (SEV3)** | Vulnerability discovered, suspicious activity, policy violation | 4 hours | Security Team |
| **Low (SEV4)** | Weak configuration, minor policy violation, false positive | 24 hours | Security Team |

---

## Incident Response Process

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  Detection   │───▶│  Containment │───▶│  Eradication │───▶│   Recovery   │
│              │    │              │    │              │    │              │
└──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
       │                                                        │
       └────────────────────────────────────────────────────────┘
                              │
                              ▼
                       ┌──────────────┐
                       │ Post-Incident│
                       │  Activities  │
                       └──────────────┘
```

---

## Detection

### Sources

| Source | Description | Priority |
|--------|-------------|----------|
| Automated Alerts | IDS/WAF triggers, anomaly detection | High |
| User Reports | Bug bounty, support tickets | High |
| Security Scans | Vulnerability scans, pen tests | Medium |
| Log Analysis | SIEM alerts, manual review | Medium |
| External Intel | Threat intel, dark web monitoring | High |

### Initial Assessment

```bash
# Check recent security events
curl -s https://api.proxyhubb.com/v1/admin/security/events \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.'

# Review failed authentication attempts
kubectl logs deployment/control-api | grep "auth_failure" | tail -100

# Check for suspicious transactions
solana transaction-history $TREASURY_ADDRESS --limit 50
```

---

## Containment

### Immediate Actions (First 15 Minutes)

1. **Isolate Affected Systems**
   ```bash
   # Block suspicious IP
   kubectl exec deployment/edge-gateway -- \
     iptables -A INPUT -s $SUSPICIOUS_IP -j DROP
   
   # Scale down compromised service
   kubectl scale deployment compromised-service --replicas=0
   
   # Revoke suspicious sessions
   redis-cli DEL "session:$SESSION_ID"
   ```

2. **Preserve Evidence**
   ```bash
   # Create forensic snapshot
   kubectl logs deployment/control-api --all-containers > /forensics/logs-$(date +%s).txt
   
   # Database snapshot
   pg_dump $DATABASE_URL > /forensics/db-$(date +%s).sql
   
   # Network capture (if ongoing)
   tcpdump -i eth0 -w /forensics/capture-$(date +%s).pcap &
   ```

3. **Alert Team**
   ```bash
   # Post to incident channel
   curl -X POST $SLACK_WEBHOOK \
     -H 'Content-type: application/json' \
     --data '{
       "channel": "#security-incidents",
       "text": "🚨 SECURITY INCIDENT - Critical",
       "attachments": [{
         "color": "danger",
         "fields": [
           {"title": "Type", "value": "Potential data breach", "short": true},
           {"title": "Time", "value": "'$(date)'", "short": true}
         ]
       }]
     }'
   ```

### Short-Term Containment (First Hour)

| Action | Command | Purpose |
|--------|---------|---------|
| Rotate credentials | `./scripts/emergency-rotation.sh all` | Prevent lateral movement |
| Enable WAF block | Update Cloudflare rule | Block attack vector |
| Force MFA re-auth | `redis-cli FLUSHDB` | Invalidate sessions |
| Pause blockchain | `solana program pause` | Stop fund transfers |
| Enable maintenance mode | `kubectl apply -f maintenance.yaml` | Protect users |

---

## Common Incident Types

### Type: Unauthorized Access

**Indicators**:
- Unknown IP in admin logs
- Privilege escalation attempts
- Unauthorized data access

**Response**:

```bash
# 1. Identify compromised account
kubectl logs deployment/control-api | grep "admin" | grep "success" | tail -50

# 2. Disable account
psql $DATABASE_URL -c "UPDATE profiles SET status = 'suspended' WHERE id = '$USER_ID';"

# 3. Revoke all sessions
redis-cli KEYS "session:$USER_ID:*" | xargs redis-cli DEL

# 4. Rotate affected secrets
./scripts/rotate-jwt-secret.sh
./scripts/rotate-db-credentials.sh

# 5. Audit accessed data
psql $DATABASE_URL -c "
  SELECT table_name, action, created_at 
  FROM audit_logs 
  WHERE user_id = '$USER_ID' 
  ORDER BY created_at DESC;
"

# 6. Block source IP
kubectl exec deployment/edge-gateway -- \
  iptables -A INPUT -s $ATTACKER_IP -j DROP
```

### Type: Data Breach

**Indicators**:
- Bulk data exfiltration
- Database dump detected
- Sensitive data in logs

**Response**:

```bash
# 1. Identify scope
psql $DATABASE_URL -c "
  SELECT COUNT(*) as affected_users 
  FROM profiles 
  WHERE updated_at > NOW() - INTERVAL '1 hour';
"

# 2. Contain breach
# - Stop data sync jobs
kubectl delete job data-sync-*
# - Enable read-only mode
kubectl set env deployment/control-api READ_ONLY_MODE=true

# 3. Preserve evidence
tar czf /forensics/breach-$(date +%s).tar.gz /var/log/

# 4. Notify legal/compliance
echo "Potential GDPR breach: $AFFECTED_USERS users" | \
  mail -s "URGENT: Data Breach Notification" legal@proxyhubb.com

# 5. Prepare user notification
# Template: templates/breach-notification.md
```

### Type: Blockchain / Financial

**Indicators**:
- Unauthorized transactions
- Oracle compromise
- Smart contract exploit

**Response**:

```bash
# 1. Check treasury balance
TREASURY_BALANCE=$(solana balance $TREASURY_ADDRESS)
if [ "$TREASURY_BALANCE" -lt "$EXPECTED_BALANCE" ]; then
  echo "ALERT: Treasury balance discrepancy!"
fi

# 2. Pause program (if emergency function exists)
solana program call $PROGRAM_ID emergency_pause \
  --keypair /secure/admin-keypair.json

# 3. Rotate oracle
./scripts/rotate-solana-oracle.sh

# 4. Trace transactions
echo "Suspicious transactions:"
solana transaction-history $TREASURY_ADDRESS | head -20

# 5. Contact exchanges (if funds moved)
# - Binance
# - FTX
# - Coinbase
```

### Type: DDoS Attack

**Indicators**:
- Traffic spike
- High error rates
- Resource exhaustion

**Response**:

```bash
# 1. Enable Cloudflare Under Attack mode
curl -X PATCH "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/settings/security_level" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"value":"under_attack"}'

# 2. Scale up
kubectl scale deployment edge-gateway --replicas=10

# 3. Enable rate limiting
kubectl set env deployment/edge-gateway RATE_LIMIT_ENABLED=true

# 4. Block at edge (if specific pattern)
# Update WAF rules via Cloudflare dashboard

# 5. Contact DDoS mitigation provider
# - Cloudflare
# - AWS Shield
```

### Type: Ransomware/Malware

**Indicators**:
- Encrypted files
- Ransom note
- Suspicious processes

**Response**:

```bash
# 1. Isolate affected systems
kubectl cordon $AFFECTED_NODE
kubectl drain $AFFECTED_NODE --force --ignore-daemonsets

# 2. Preserve evidence (memory dump, disk image)
# Do not shut down - capture volatile memory

# 3. Check backups
aws s3 ls s3://proxyhubb-backups/ | tail -5

# 4. DO NOT PAY RANSOM
# Follow law enforcement guidance

# 5. Rebuild from clean backups
# - New Kubernetes cluster
# - Restore from verified clean backup
# - Rotate all credentials
```

---

## Eradication

### Remove Threat

```bash
# 1. Identify and remove malware/backdoors
# Scan all containers
kubectl get pods --all-namespaces -o json | \
  jq -r '.items[].spec.containers[].image' | sort | uniq

# 2. Patch vulnerabilities
# Update to latest secure versions
kubectl set image deployment/control-api control-api=ghcr.io/proxyhubb/control-api:v1.2.4-security

# 3. Remove compromised accounts
psql $DATABASE_URL -c "DELETE FROM api_keys WHERE last_used_by = '$ATTACKER_IP';"

# 4. Clean infected files
# Restore from known-good backup
aws s3 cp s3://proxyhubb-backups/clean-state/ /restore/
```

### Verify Cleanliness

```bash
# Run security scans
govulncheck ./...
cargo audit
npm audit
trivy fs .

# Check for persistence mechanisms
crontab -l
systemctl list-units --type=service --state=running
```

---

## Recovery

### Restore Services

```bash
# 1. Deploy clean infrastructure
kubectl apply -f infra/k8s/overlays/production

# 2. Restore data from clean backup
pg_restore -d $DATABASE_URL /backups/clean-backup.sql

# 3. Verify integrity
./scripts/verify-integrity.sh

# 4. Gradual traffic restoration
# Start with 10% traffic, monitor, then increase
kubectl patch virtualservice proxyhubb \
  -p '{"spec":{"http":[{"route":[{"destination":{"host":"proxyhubb"},"weight":10}]}]}}'
```

### Post-Recovery Monitoring

Monitor for 72 hours:
- Re-infection indicators
- Unusual traffic patterns
- Failed authentication attempts
- Blockchain anomalies

---

## Communication Templates

### Internal (First Hour)

```
🚨 SECURITY INCIDENT - SEV1/SEV2

Time Detected: [TIMESTAMP]
Incident Type: [TYPE]
Severity: [SEV LEVEL]
Status: [CONTAINING/INVESTIGATING/RESOLVED]

Initial Assessment:
- [Brief description]
- Affected systems: [LIST]
- Potential impact: [DESCRIPTION]

Actions Taken:
- [Action 1]
- [Action 2]

Next Update: [TIME] (15 minutes)

Incident Commander: [NAME]
War Room: [MEETING LINK]
```

### User Notification (Data Breach)

```
Subject: Important Security Notice - ProxyHubb Account

Dear [User],

We are writing to inform you of a security incident that may have affected your ProxyHubb account.

What happened:
On [DATE], we detected unauthorized access to our systems. We immediately took action to secure the affected systems and investigate the incident.

What information was involved:
- [Specific data types]
- [What was NOT accessed]

What we are doing:
- We have secured the vulnerability
- We are working with cybersecurity experts
- We have notified law enforcement and regulators

What you should do:
1. Change your password immediately
2. Enable two-factor authentication
3. Monitor your account for suspicious activity

We sincerely apologize for this incident and any inconvenience it may cause.

For questions, contact: security@proxyhubb.com

Sincerely,
ProxyHubb Security Team
```

### Regulatory Notification (GDPR)

```
To: [Supervisory Authority]
Subject: Data Breach Notification - Article 33

1. Nature of breach: [DESCRIPTION]
2. Categories of data: [LIST]
3. Approximate number affected: [NUMBER]
4. Likely consequences: [DESCRIPTION]
5. Measures taken: [LIST]
6. Contact: security@proxyhubb.com
```

---

## Post-Incident Activities

### Timeline (Within 24 Hours)

| Time | Activity | Owner |
|------|----------|-------|
| +1h | Initial report to management | Incident Commander |
| +4h | Law enforcement notification (if required) | Legal |
| +24h | Regulatory notifications (GDPR, etc.) | Compliance |
| +48h | User notifications (if required) | Comms Team |
| +72h | Post-mortem meeting | Security Lead |
| +1w | Post-mortem report | Security Team |

### Post-Mortem Questions

1. What happened? (Timeline)
2. How was it detected?
3. What was the root cause?
4. How was it contained?
5. What data was affected?
6. What worked well?
7. What could be improved?
8. What preventive measures are needed?

### Follow-Up Actions

```yaml
# security/incident-2026-03-09.yml
incident_id: INC-2026-0309-001
date: "2026-03-09"
type: "unauthorized_access"
severity: "high"

root_cause: "Compromised API key with excessive permissions"

actions:
  - description: "Implement API key expiration"
    owner: "@backend-team"
    due_date: "2026-03-16"
    status: "in_progress"
    
  - description: "Add IP allowlisting for admin keys"
    owner: "@security-team"
    due_date: "2026-03-16"
    status: "pending"
    
  - description: "Enhance audit logging"
    owner: "@backend-team"
    due_date: "2026-03-23"
    status: "pending"

lessons_learned:
  - "API keys should have automatic expiration"
  - "Admin operations need additional MFA"
  - "Need better anomaly detection"
```

---

## Resources

### Internal
- Security Team: security@proxyhubb.com
- On-Call: +1-XXX-XXX-XXXX
- Slack: #security-incidents

### External
- FBI IC3: https://www.ic3.gov
- CISA: https://www.cisa.gov
- Local CERT

### Tools
```bash
# Digital forensics
volatility # Memory analysis
autopsy    # Disk analysis
sleuthkit  # File system analysis

# Network analysis
wireshark
tcpdump

# Malware analysis
virustotal.com
hybrid-analysis.com
```

---

Last updated: 2026-03-09

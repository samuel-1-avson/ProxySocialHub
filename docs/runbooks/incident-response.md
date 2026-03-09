# Incident Response Runbook

## Overview

This runbook provides step-by-step instructions for handling production incidents.

## Incident Response Process

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  Detection  │───▶│  Triage     │───▶│  Response   │───▶│  Resolution │
│  (Alert)    │    │  (Assess)   │    │  (Fix)      │    │  (Verify)   │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
       │                  │                  │                  │
       ▼                  ▼                  ▼                  ▼
  Page On-Call      Update Status      War Room if      Post-Mortem
  Engineer          Page              SEV1/SEV2        within 48h
```

## Phase 1: Detection

### Sources
- PagerDuty alerts
- Grafana alerts
- User reports (Slack #support, email)
- Monitoring dashboards

### Immediate Actions

1. **Acknowledge the alert** in PagerDuty within 5 minutes
2. **Create incident channel** in Slack: `#incident-YYYY-MM-DD-brief-name`
3. **Update status page** if user-facing

## Phase 2: Triage

### Assess Severity

| Severity | Criteria | Response |
|----------|----------|----------|
| **SEV1** | Complete system outage, data loss, security breach | All hands, war room |
| **SEV2** | Major feature degraded, >50% users affected | On-call + backup |
| **SEV3** | Minor feature broken, <50% users affected | On-call only |
| **SEV4** | Cosmetic issues, workarounds available | Business hours |

### Gather Information

Run these commands to assess the situation:

```bash
# 1. Check service health
curl -s http://localhost:8081/health | jq .
curl -s http://localhost:8090/health | jq .

# 2. Check recent deployments
kubectl rollout history deployment/control-api
kubectl rollout history deployment/edge-gateway

# 3. Check error rates
# View Grafana: http://localhost:3001/d/api-performance

# 4. Check logs
kubectl logs -f deployment/control-api --tail=500 --previous

# 5. Check resource usage
kubectl top pods
kubectl top nodes

# 6. Check database
psql $DATABASE_URL -c "SELECT count(*), state FROM pg_stat_activity GROUP BY state;"

# 7. Check Redis
redis-cli info stats
```

### Update Status Page

For SEV1 and SEV2:
1. Go to https://admin.statuspage.io
2. Create incident
3. Select affected components
4. Post initial update

## Phase 3: Response

### SEV1 Response

1. **Start War Room** (Google Meet)
   - Post link in #incidents
   - Invite: On-call, Tech Lead, relevant domain experts

2. **Assign Roles**
   - **Incident Commander**: Coordinates response
   - **Communications Lead**: Updates status page
   - **Technical Lead**: Drives technical resolution

3. **Communication Cadence**
   - Every 15 minutes during active response
   - Post updates in #incidents and status page

### Common Incident Types

#### Type: High Error Rate

**Symptoms**: Error rate > 5%, users reporting failures

**Investigation**:
```bash
# Check error distribution by endpoint
kubectl logs deployment/control-api | grep "ERROR" | jq '.endpoint' | sort | uniq -c | sort -rn

# Check recent changes
git log --oneline -20

# Check external dependencies
kubectl logs deployment/control-api | grep "timeout\|connection refused"
```

**Response**:
1. If recent deployment: `kubectl rollout undo deployment/control-api`
2. If database issue: Check connection pool, run VACUUM if needed
3. If external service down: Enable circuit breaker, queue requests

#### Type: High Latency

**Symptoms**: P99 latency > 2s, timeouts

**Investigation**:
```bash
# Check slow queries
psql $DATABASE_URL -c "SELECT query, mean_time FROM pg_stat_statements ORDER BY mean_time DESC LIMIT 10;"

# Check Redis latency
redis-cli --latency

# Check Solana RPC health
curl -s $SOLANA_RPC_ENDPOINT/health
```

**Response**:
1. Scale horizontally: `kubectl scale deployment/control-api --replicas=5`
2. Enable rate limiting if traffic spike
3. Check for N+1 queries, add caching

#### Type: Database Issues

**Symptoms**: Connection timeouts, slow queries, deadlocks

**Investigation**:
```bash
# Check active connections
psql $DATABASE_URL -c "SELECT pid, state, query_start, query FROM pg_stat_activity WHERE state != 'idle';"

# Check locks
psql $DATABASE_URL -c "SELECT * FROM pg_locks WHERE NOT granted;"

# Check replication lag
psql $DATABASE_URL -c "SELECT extract(epoch from (now() - pg_last_xact_replay_timestamp())) AS lag_seconds;"
```

**Response**:
1. Kill long-running queries if safe
2. Restart connection pool
3. Failover to replica if primary failing

#### Type: Solana Blockchain Issues

**Symptoms**: Transactions failing, oracle not responding

**Investigation**:
```bash
# Check oracle wallet balance
solana balance $ORACLE_ADDRESS --url $SOLANA_RPC_ENDPOINT

# Check transaction history
solana transaction-history $ORACLE_ADDRESS --limit 10

# Check program deployment
solana program show $PROGRAM_ID --url $SOLANA_RPC_ENDPOINT
```

**Response**:
1. Switch to backup RPC endpoint
2. Fund oracle wallet if low balance
3. Pause blockchain operations if network down

### Communication Template

**Initial Update** (5 minutes after detection):
```
🚨 INCIDENT: Brief description
Severity: SEV1/SEV2/SEV3
Impact: What users are experiencing
Status: Investigating
ETA: Next update in 15 minutes
Channel: #incident-YYYY-MM-DD-name
```

**Progress Update** (every 15 minutes):
```
📊 INCIDENT UPDATE: Brief description
Status: Identified/Fixing/Monitoring
What we know: Summary of findings
What we're doing: Current action
ETA: Next update in 15 minutes / estimated resolution time
```

**Resolution**:
```
✅ INCIDENT RESOLVED: Brief description
Duration: X minutes
Root cause: Brief explanation
Resolution: What fixed it
Next steps: Post-mortem scheduled for [time]
```

## Phase 4: Resolution

### Verification

1. **Verify fix**:
   ```bash
   # Run smoke tests
   curl http://localhost:8081/health
   curl http://localhost:8081/v1/system/status
   ```

2. **Monitor metrics** for 15 minutes
3. **Check error rates** return to normal
4. **Verify with users** if possible

### Post-Incident

1. **Close incident** in PagerDuty
2. **Update status page** to resolved
3. **Schedule post-mortem** within 48 hours
4. **Create follow-up tickets** for action items

## Post-Mortem Template

```markdown
# Post-Mortem: [Incident Title]

## Summary
- **Date**: YYYY-MM-DD
- **Duration**: X minutes
- **Severity**: SEV1/SEV2/SEV3
- **Impact**: Brief description of user impact

## Timeline
| Time | Event |
|------|-------|
| 14:00 | Alert fired |
| 14:05 | On-call acknowledged |
| 14:15 | Issue identified |
| 14:30 | Fix deployed |
| 14:45 | Service restored |

## Root Cause Analysis
5 Whys:
1. Why? ...
2. Why? ...
3. Why? ...
4. Why? ...
5. Why? ...

## Impact
- X users affected
- Y transactions failed
- $Z revenue impact

## Lessons Learned
- What went well
- What could have gone better

## Action Items
| Item | Owner | Due Date |
|------|-------|----------|
| Fix | Name | Date |
```

## Escalation

If incident is not resolved within:

| Time | Action |
|------|--------|
| 15 minutes | Page Tech Lead |
| 30 minutes | Page Engineering Manager |
| 1 hour | Page CTO |
| 2 hours | Executive notification |

## Resources

- [PagerDuty](https://proxyhubb.pagerduty.com)
- [Grafana](https://grafana.proxyhubb.com)
- [Status Page](https://status.proxyhubb.com)
- [Slack #incidents](https://proxyhubb.slack.com/archives/incidents)

---

Last updated: 2026-03-09

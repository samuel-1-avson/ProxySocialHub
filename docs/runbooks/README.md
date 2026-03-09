# Operational Runbooks

This directory contains operational runbooks for common procedures and incident response.

## Index

| Runbook | Description | Priority |
|---------|-------------|----------|
| [Database Backup & Restore](database-backup-restore.md) | Database backup procedures | Critical |
| [Deployment](deployment.md) | Deployment procedures | Critical |
| [Incident Response](incident-response.md) | Incident handling process | Critical |
| [Scaling](scaling.md) | Horizontal/vertical scaling | High |
| [Security Incident](security-incident.md) | Security breach response | Critical |
| [Solana Oracle Recovery](solana-oracle-recovery.md) | Oracle wallet recovery | Critical |

## Quick Reference

### Emergency Contacts

| Role | Name | Phone | Slack |
|------|------|-------|-------|
| On-Call Engineer | - | PagerDuty | #incidents |
| Tech Lead | - | - | @tech-lead |
| Security Team | - | - | @security |
| Solana Expert | - | - | @solana-team |

### Critical Commands

```bash
# Check system health
curl http://localhost:8081/health

# View recent logs
kubectl logs -f deployment/control-api --tail=100

# Scale up API
kubectl scale deployment/control-api --replicas=5

# Restart service
kubectl rollout restart deployment/control-api

# Rollback deployment
kubectl rollout undo deployment/control-api

# Check database connections
psql $DATABASE_URL -c "SELECT count(*) FROM pg_stat_activity;"

# Redis health
redis-cli ping

# Check Solana oracle balance
solana balance $ORACLE_ADDRESS --url $SOLANA_RPC_ENDPOINT
```

## Severity Levels

| Level | Description | Response Time | Examples |
|-------|-------------|---------------|----------|
| SEV1 | Critical - Complete outage | 15 minutes | All services down, data loss |
| SEV2 | High - Major functionality impaired | 1 hour | High error rate, performance degraded |
| SEV3 | Medium - Minor functionality impaired | 4 hours | Single feature not working |
| SEV4 | Low - Cosmetic issues | 1 day | UI glitches, non-urgent bugs |

## Escalation Path

```
On-Call Engineer (15 min)
    ↓
Tech Lead (30 min)
    ↓
Engineering Manager (1 hour)
    ↓
CTO (2 hours)
```

## Communication Channels

- **Incidents**: #incidents (Slack)
- **War Room**: Meet link posted in #incidents
- **Status Page**: https://status.proxyhubb.com
- **Post-Mortems**: #post-mortems

---

Last updated: 2026-03-09

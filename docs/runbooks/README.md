# Operational Runbooks

This directory contains operational runbooks for common procedures and incident response.

## Index

| Runbook | Description | Priority |
| ------- | ----------- | -------- |
| [Database Backup & Restore](database-backup-restore.md) | Database backup procedures | Critical |
| [Deployment](deployment.md) | Deployment procedures | Critical |
| [Gateway And Session Secret Rotation](gateway-session-secret-rotation.md) | RC-04 secret rotation for gateway auth and session-intent signing | High |
| [Incident Response](incident-response.md) | Incident handling process | Critical |
| [Public Testnet Authority Matrix](public-testnet-authority-matrix.md) | RC-08 authority labels for release-critical public-testnet flows | High |
| [Public Testnet Release Gate](public-testnet-release-gate.md) | RC-09 command set and artifacts for release promotion blocking | High |
| [Public Testnet Settlement Validation](public-testnet-settlement-validation.md) | RC-03 settlement lifecycle validation path | High |
| [Scaling](scaling.md) | Horizontal/vertical scaling | High |
| [Security Incident](security-incident.md) | Security breach response | Critical |
| [Solana Oracle Recovery](solana-oracle-recovery.md) | Oracle wallet recovery | Critical |

## Quick Reference

### Local Port Notes

- Web app dev server: `http://127.0.0.1:4001`
- Local IPFS swarm port: map container `4001/tcp` to host `4401/tcp` when it runs beside the web app
- Local IPFS API: `http://127.0.0.1:5001`
- Local IPFS gateway: `http://127.0.0.1:8081`
- Recreate the local IPFS container with the remap: `docker run -d --name creg-testnet-ipfs --restart unless-stopped --network chain-registry_default -p 4401:4001 -p 5001:5001 -p 8081:8080 ipfs/kubo:v0.27.0 daemon --init --init-profile=server --routing=dhtclient`

### Emergency Contacts

| Role | Name | Phone | Slack |
| ---- | ---- | ----- | ----- |
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
| ----- | ----------- | ------------- | -------- |
| SEV1 | Critical - Complete outage | 15 minutes | All services down, data loss |
| SEV2 | High - Major functionality impaired | 1 hour | High error rate, performance degraded |
| SEV3 | Medium - Minor functionality impaired | 4 hours | Single feature not working |
| SEV4 | Low - Cosmetic issues | 1 day | UI glitches, non-urgent bugs |

## Escalation Path

```text
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
- **Status Page**: <https://status.proxyhubb.com>
- **Post-Mortems**: #post-mortems

---

Last updated: 2026-04-16

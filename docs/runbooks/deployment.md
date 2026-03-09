# Deployment Runbook

## Overview

This runbook covers deployment procedures for all ProxyHubb services.

## Deployment Types

| Type | Frequency | Description |
|------|-----------|-------------|
| **Continuous** | On every merge to main | Automated to staging |
| **Release** | Weekly/bi-weekly | Tagged release to production |
| **Hotfix** | As needed | Critical fix to production |
| **Emergency** | Immediate | Rollback or urgent fix |

## Pre-Deployment Checklist

- [ ] All tests passing in CI
- [ ] Code review approved
- [ ] Database migrations reviewed
- [ ] Feature flags configured (if needed)
- [ ] Monitoring dashboards checked
- [ ] Rollback plan prepared
- [ ] Change log updated

---

## Staging Deployment

### Automatic (CI/CD)

Staging deploys automatically on merge to `main`:

```bash
# CI/CD handles this, but to verify:
kubectl get pods -n staging
kubectl logs -f deployment/control-api -n staging
```

### Manual Deployment

```bash
# 1. Build images
docker build -t ghcr.io/proxyhubb/control-api:staging ./services/control-api
docker build -t ghcr.io/proxyhubb/web:staging ./apps/web

# 2. Push images
docker push ghcr.io/proxyhubb/control-api:staging
docker push ghcr.io/proxyhubb/web:staging

# 3. Update Kubernetes
kubectl set image deployment/control-api \
  control-api=ghcr.io/proxyhubb/control-api:staging \
  -n staging

# 4. Verify rollout
kubectl rollout status deployment/control-api -n staging

# 5. Run smoke tests
./scripts/smoke-tests.sh staging
```

---

## Production Deployment

### Standard Release

#### Step 1: Prepare Release

```bash
# 1. Ensure main is green
git checkout main
git pull origin main

# 2. Create release branch
git checkout -b release/v1.2.3

# 3. Update version
# Edit version.go, package.json, Cargo.toml

# 4. Update CHANGELOG.md
# Document all changes since last release

# 5. Commit and push
git add .
git commit -m "chore(release): prepare v1.2.3"
git push origin release/v1.2.3
```

#### Step 2: Deploy to Staging

```bash
# Merge release branch to main (triggers staging deploy)
git checkout main
git merge release/v1.2.3
git push origin main

# Wait for staging deployment and verify
./scripts/smoke-tests.sh staging
```

#### Step 3: Production Deploy

```bash
# 1. Tag the release
git tag -a v1.2.3 -m "Release v1.2.3"
git push origin v1.2.3

# 2. CI/CD will deploy automatically
# Monitor progress in GitHub Actions

# 3. Or deploy manually if needed:
kubectl apply -k infra/k8s/overlays/production
kubectl rollout status deployment/control-api -n production
```

#### Step 4: Verify Production

```bash
# 1. Check pod status
kubectl get pods -n production

# 2. Check logs for errors
kubectl logs -f deployment/control-api -n production --tail=100

# 3. Run smoke tests
./scripts/smoke-tests.sh production

# 4. Check metrics
# Open Grafana and verify error rates, latency

# 5. Check Sentry for new errors
```

### Hotfix Deployment

For urgent fixes:

```bash
# 1. Create hotfix branch from main
git checkout main
git pull origin main
git checkout -b hotfix/critical-fix

# 2. Make minimal fix
git add .
git commit -m "fix: critical issue description"

# 3. Fast-track review (bypass normal process if SEV1)
# Get at least 1 approval

# 4. Tag and deploy
git tag -a v1.2.3-hotfix1 -m "Hotfix for critical issue"
git push origin v1.2.3-hotfix1

# 5. Monitor closely
```

### Database Migrations

#### Pre-Migration Checklist

- [ ] Migration tested in staging
- [ ] Backup created (if risky)
- [ ] Rollback plan documented
- [ ] Migration is backward compatible (if possible)

#### Running Migrations

```bash
# 1. Create backup (if needed)
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d-%H%M%S).sql

# 2. Run migrations
cd services/control-api
go run main.go migrate up

# 3. Verify migration applied
psql $DATABASE_URL -c "SELECT * FROM schema_migrations;"

# 4. Check application logs for errors
kubectl logs -f deployment/control-api --tail=100
```

#### Rollback Migrations

```bash
# 1. If migration failed, rollback
go run main.go migrate down

# 2. Restore from backup if needed
psql $DATABASE_URL < backup-YYYY-MM-DD-HHMMSS.sql

# 3. Verify application health
```

---

## Rollback Procedures

### Quick Rollback (Kubernetes)

```bash
# Rollback to previous revision
kubectl rollout undo deployment/control-api -n production

# Verify rollback
kubectl rollout status deployment/control-api -n production

# Check previous revisions
kubectl rollout history deployment/control-api -n production
```

### Full Rollback (Images)

```bash
# 1. Identify previous stable tag
kubectl get deployment control-api -n production -o yaml | grep image:

# 2. Revert to previous tag
kubectl set image deployment/control-api \
  control-api=ghcr.io/proxyhubb/control-api:v1.2.2 \
  -n production

# 3. Verify
kubectl rollout status deployment/control-api -n production
```

### Database Rollback

```bash
# Only if migration caused issues

# 1. Stop application
kubectl scale deployment control-api --replicas=0 -n production

# 2. Restore database
pg_restore -d $DATABASE_URL backup-YYYY-MM-DD-HHMMSS.sql

# 3. Restart application
kubectl scale deployment control-api --replicas=3 -n production
```

---

## Feature Flags

### Gradual Rollout

Use feature flags for risky changes:

```go
// Check feature flag
if config.IsEnabled("new-billing-flow") {
    // New code
} else {
    // Old code
}
```

### Rollout Steps

1. Deploy with flag **disabled**
2. Enable for 5% of users
3. Monitor for 1 hour
4. Increase to 25%
5. Monitor for 4 hours
6. Increase to 100%
7. Remove flag in next release

---

## Verification Checklist

After any deployment:

- [ ] All pods running: `kubectl get pods`
- [ ] Health checks passing: `curl /health`
- [ ] No errors in logs: `kubectl logs`
- [ ] Metrics look normal (Grafana)
- [ ] No new Sentry errors
- [ ] Smoke tests passing
- [ ] User-facing features working

## Deployment Notifications

Deployments automatically notify:
- Slack #deployments channel
- PagerDuty (for production)

### Manual Notification

```bash
# Post to Slack
curl -X POST -H 'Content-type: application/json' \
  --data '{"text":"Deployed v1.2.3 to production"}' \
  $SLACK_WEBHOOK_URL
```

---

## Troubleshooting

### Deployment Stuck

```bash
# Check rollout status
kubectl rollout status deployment/control-api -n production

# Check events
kubectl get events -n production --sort-by='.lastTimestamp'

# Check pod logs
kubectl logs deployment/control-api -n production --previous

# Force restart
kubectl rollout restart deployment/control-api -n production
```

### Image Pull Errors

```bash
# Verify image exists
docker pull ghcr.io/proxyhubb/control-api:v1.2.3

# Check image pull secrets
kubectl get secrets -n production

# Re-create secret if needed
kubectl create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io \
  --docker-username=$USERNAME \
  --docker-password=$TOKEN \
  -n production
```

### Resource Limits

```bash
# Check resource usage
kubectl top pods -n production

# Increase limits temporarily
kubectl patch deployment control-api -n production -p '{"spec":{"template":{"spec":{"containers":[{"name":"control-api","resources":{"limits":{"cpu":"2000m","memory":"4Gi"}}}]}}}}'
```

---

Last updated: 2026-03-09

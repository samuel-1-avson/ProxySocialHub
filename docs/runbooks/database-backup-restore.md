# Database Backup & Restore Runbook

## Overview

This runbook covers PostgreSQL backup and restore procedures for the ProxyHubb system.

## Backup Strategy

| Type | Frequency | Retention | Method |
|------|-----------|-----------|--------|
| **Automated** | Hourly | 7 days | Supabase native |
| **Automated** | Daily | 30 days | pg_dump |
| **Manual** | Before deploy | Until next release | pg_dump |
| **Point-in-time** | Continuous | 7 days | WAL archiving |

---

## Automated Backups

### Supabase Managed Backups

If using Supabase, backups are automatic:

```bash
# List available backups
supabase backups list --project-ref $PROJECT_REF

# Download a backup
supabase backups download --project-ref $PROJECT_REF backup-id
```

### Self-Managed Backups

For self-hosted PostgreSQL:

```bash
# Create backup directory
mkdir -p /backups/postgresql

# Daily backup cron job (0 2 * * *)
0 2 * * * /usr/local/bin/pg_backup.sh >> /var/log/pg_backup.log 2>&1
```

**Backup Script** (`/usr/local/bin/pg_backup.sh`):

```bash
#!/bin/bash
set -e

# Configuration
DB_NAME="proxyhubb"
BACKUP_DIR="/backups/postgresql"
DATE=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=30

# Create backup
pg_dump -Fc $DATABASE_URL > "$BACKUP_DIR/${DB_NAME}_${DATE}.dump"

# Compress
gzip "$BACKUP_DIR/${DB_NAME}_${DATE}.dump"

# Upload to S3
aws s3 cp "$BACKUP_DIR/${DB_NAME}_${DATE}.dump.gz" s3://proxyhubb-backups/postgresql/

# Clean up old backups locally
find "$BACKUP_DIR" -name "${DB_NAME}_*.dump.gz" -mtime +$RETENTION_DAYS -delete

# Clean up old backups in S3
aws s3 ls s3://proxyhubb-backups/postgresql/ | \
  awk '{print $4}' | \
  while read file; do
    aws s3api head-object --bucket proxyhubb-backups --key "postgresql/$file" | \
    jq -r '.LastModified' | \
    xargs -I {} date -d {} +%s | \
    awk -v cutoff=$(date -d "30 days ago" +%s) '$1 < cutoff {print "postgresql/" file}' | \
    xargs -I {} aws s3 rm s3://proxyhubb-backups/{}
  done

echo "Backup completed: ${DB_NAME}_${DATE}.dump.gz"
```

---

## Manual Backups

### Before Deployment

Always backup before deploying:

```bash
# Create deployment backup
BACKUP_FILE="pre-deploy-$(date +%Y%m%d-%H%M%S).sql"
pg_dump $DATABASE_URL > /backups/$BACKUP_FILE

gzip /backups/$BACKUP_FILE

# Verify backup
ls -lh /backups/$BACKUP_FILE.gz
```

### Specific Table Backup

```bash
# Backup specific tables
pg_dump $DATABASE_URL \
  --table=sessions \
  --table=orders \
  --table=escrow_transactions \
  > /backups/critical-tables-$(date +%Y%m%d).sql
```

### Schema-only Backup

```bash
# Backup just schema (no data)
pg_dump $DATABASE_URL --schema-only > /backups/schema-$(date +%Y%m%d).sql
```

---

## Restore Procedures

### Full Database Restore

⚠️ **Warning**: This will replace current data!

```bash
# 1. Stop application
kubectl scale deployment control-api --replicas=0

# 2. Download backup from S3 (if needed)
aws s3 cp s3://proxyhubb-backups/postgresql/proxyhubb_20260309_020000.dump.gz /tmp/

gunzip /tmp/proxyhubb_20260309_020000.dump.gz

# 3. Drop and recreate database (extreme case)
# psql $DATABASE_URL -c "DROP DATABASE proxyhubb;"
# psql $DATABASE_URL -c "CREATE DATABASE proxyhubb;"

# 4. Restore (preferred - restore into existing)
pg_restore -d $DATABASE_URL \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  /tmp/proxyhubb_20260309_020000.dump

# 5. Verify restore
psql $DATABASE_URL -c "SELECT count(*) FROM profiles;"

# 6. Restart application
kubectl scale deployment control-api --replicas=3
```

### Point-in-Time Recovery

For PostgreSQL with WAL archiving:

```bash
# 1. Stop PostgreSQL
sudo systemctl stop postgresql

# 2. Remove data directory
sudo mv /var/lib/postgresql/data /var/lib/postgresql/data.bak

# 3. Restore base backup
pg_basebackup -D /var/lib/postgresql/data -X fetch

# 4. Configure recovery
# Edit postgresql.conf and recovery.conf

# 5. Start PostgreSQL
sudo systemctl start postgresql
```

### Selective Restore

Restore only specific tables:

```bash
# Restore specific tables
pg_restore -d $DATABASE_URL \
  --table=sessions \
  --data-only \
  /backups/proxyhubb_20260309_020000.dump
```

---

## Migration Rollback

If a migration needs to be rolled back:

```bash
# 1. Check current migration version
cd services/control-api
go run main.go migrate version

# 2. Rollback one migration
go run main.go migrate down

# 3. Or rollback to specific version
go run main.go migrate goto 20260121000000

# 4. Verify
psql $DATABASE_URL -c "SELECT * FROM schema_migrations;"
```

---

## Verification

### Check Backup Integrity

```bash
# Verify dump is valid
pg_restore --list /backups/proxyhubb_20260309_020000.dump > /dev/null && echo "Valid" || echo "Corrupt"

# Test restore to temporary database
createdb test_restore
pg_restore -d test_restore /backups/proxyhubb_20260309_020000.dump
psql test_restore -c "SELECT count(*) FROM profiles;"
dropdb test_restore
```

### Backup Monitoring

```bash
# Check backup size
du -h /backups/*.dump.gz | sort -k2

# Check backup age
find /backups -name "*.dump.gz" -mtime +1

# Check S3 backup list
aws s3 ls s3://proxyhubb-backups/postgresql/ | tail -20
```

---

## Disaster Recovery

### Complete Database Loss

```bash
# Scenario: Database completely lost

# 1. Create new PostgreSQL instance
# (Use your cloud provider or Docker)

# 2. Download latest backup
LATEST_BACKUP=$(aws s3 ls s3://proxyhubb-backups/postgresql/ | sort | tail -1 | awk '{print $4}')
aws s3 cp s3://proxyhubb-backups/postgresql/$LATEST_BACKUP /tmp/

# 3. Restore
gunzip /tmp/$LATEST_BACKUP
dropdb proxyhubb 2>/dev/null || true
createdb proxyhubb
pg_restore -d $DATABASE_URL /tmp/${LATEST_BACKUP%.gz}

# 4. Run any migrations since backup
cd services/control-api
go run main.go migrate up

# 5. Verify
psql $DATABASE_URL -c "SELECT count(*) FROM profiles;"
```

### Cross-Region Recovery

```bash
# Replicate to secondary region
aws s3 sync s3://proxyhubb-backups-postgresql s3://proxyhubb-backups-dr/postgresql

# In DR region, restore from S3
aws s3 cp s3://proxyhubb-backups-dr/postgresql/latest.dump.gz /tmp/
# ... restore procedure
```

---

## Maintenance

### Clean Up Old Backups

```bash
# Remove backups older than 30 days
find /backups -name "*.dump.gz" -mtime +30 -delete

# Remove from S3
aws s3 ls s3://proxyhubb-backups/postgresql/ | \
  awk '$1 < "2026-02-01" {print $4}' | \
  xargs -I {} aws s3 rm s3://proxyhubb-backups/postgresql/{}
```

### Backup Testing Schedule

Monthly: Test restore procedure on staging

```bash
# Monthly backup test
echo "Testing backup restore..."
./scripts/test-backup-restore.sh
```

---

## Checklist

### Before Backup

- [ ] Sufficient disk space
- [ ] Database is accessible
- [ ] No long-running queries blocking dump

### After Backup

- [ ] Backup file exists and has size > 0
- [ ] Backup uploaded to S3
- [ ] Backup integrity verified
- [ ] Old backups cleaned up

### After Restore

- [ ] Application starts successfully
- [ ] Critical tables have expected row counts
- [ ] Application functionality verified
- [ ] Monitoring shows healthy state

---

Last updated: 2026-03-09

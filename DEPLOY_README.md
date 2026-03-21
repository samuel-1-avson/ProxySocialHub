# PAYG Social System - Docker Deployment

**Choose your deployment method:**

---

## Quick Start (Recommended)

### Windows (PowerShell)

```powershell
# Option 1: Full deployment (with all checks and backups)
.\deploy-social-update.ps1

# Option 2: Simple deployment (faster, minimal output)
.\deploy-social-update-simple.ps1
```

### Linux/Mac (Bash)

```bash
# Full deployment
chmod +x deploy-social-update.sh
./deploy-social-update.sh
```

---

## Which Script Should I Use?

### `deploy-social-update.ps1` (Full)
**Use this when:**
- First time deploying social features
- You want automatic backups
- You want detailed health checks
- You want environment variables auto-added
- You want verbose output

**Features:**
- ✅ Database backup
- ✅ Environment variable validation
- ✅ Step-by-step progress
- ✅ Health checks
- ✅ Migration verification
- ✅ API endpoint testing
- ✅ Colored output

**Runtime:** ~5-10 minutes

---

### `deploy-social-update-simple.ps1` (Simple)
**Use this when:**
- You've run the full script before
- You're confident in your setup
- You want faster deployment
- You don't need backups

**Features:**
- ✅ Quick environment setup
- ✅ Image rebuild
- ✅ Migration run
- ✅ Services start
- ⚡ Minimal output

**Runtime:** ~3-5 minutes

---

## Manual Deployment

If you prefer to run commands manually:

```powershell
# 1. Stop services
docker-compose down

# 2. Add environment variables (copy from .env.example)

# 3. Rebuild images
docker-compose build --no-cache control-api web

# 4. Run migrations
docker-compose up db-migrate

# 5. Start services
docker-compose up -d

# 6. Check health
Invoke-WebRequest http://localhost:8081/health -UseBasicParsing
```

---

## Post-Deployment Verification

### Check All Services Running
```powershell
docker-compose ps
```

### Check Milestone Worker
```powershell
docker-compose logs control-api | Select-String "UsageMilestoneWorker"
```

### Check New Tables
```powershell
docker-compose exec postgres psql -U proxyhubb -d proxyhubb -c "\dt"
```

### Test API
```powershell
# Milestones
Invoke-WebRequest http://localhost:8081/api/v1/milestones -UseBasicParsing

# Social context (replace <id> with actual listing ID)
Invoke-WebRequest http://localhost:8081/api/v1/listings/<id>/social -UseBasicParsing
```

---

## Troubleshooting

### Script Execution Policy (Windows)

If you get an error about execution policy:

```powershell
# Check current policy
Get-ExecutionPolicy

# Set policy for current user (if needed)
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# Or run with bypass
powershell -ExecutionPolicy Bypass -File .\deploy-social-update.ps1
```

### Docker Not Running

```powershell
# Check Docker status
docker info

# Start Docker Desktop if needed
```

### Port Conflicts

```powershell
# Check what's using port 8081
netstat -ano | findstr :8081

# Check what's using port 3000
netstat -ano | findstr :3000
```

---

## Rollback

If something goes wrong:

```powershell
# Stop services
docker-compose down

# Restore database (if you have backup from scripts\backups folder)
docker-compose up -d postgres
$Backup = Get-ChildItem backups | Sort-Object LastWriteTime -Descending | Select-Object -First 1
docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb < $Backup.FullName

# Rebuild and start
docker-compose build --no-cache
docker-compose up -d
```

---

## Files Reference

| File | Description |
|------|-------------|
| `deploy-social-update.ps1` | Full PowerShell deployment script |
| `deploy-social-update-simple.ps1` | Simple PowerShell deployment script |
| `deploy-social-update.sh` | Bash deployment script (Linux/Mac) |
| `DOCKER_SOCIAL_UPDATE.md` | Complete deployment documentation |
| `DOCKER_UPDATE_QUICKREF.md` | Quick reference commands |
| `DOCKER_CHANGES_SUMMARY.md` | Summary of all Docker changes |

---

## Support

If you encounter issues:

1. Check logs: `docker-compose logs <service>`
2. Check health: `docker-compose ps`
3. Review documentation: `DOCKER_SOCIAL_UPDATE.md`
4. Check troubleshooting section above

---

**Happy deploying!** 🚀

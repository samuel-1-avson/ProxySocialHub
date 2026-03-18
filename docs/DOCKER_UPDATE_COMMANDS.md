# Docker Update Commands - Node Map Fixes

**Date:** 2026-03-15  
**Purpose:** Apply all Node Map fixes in Docker environment

---

## 🚀 Quick Start - Apply All Fixes

### Step 1: Stop Current Containers
```bash
docker-compose down
```

### Step 2: Rebuild Web Container (With New Code)
```bash
# Rebuild web container with no cache to ensure fresh build
docker-compose build --no-cache web
```

### Step 3: Start All Services
```bash
# Start everything in detached mode
docker-compose up -d

# OR start with logs visible
docker-compose up
```

### Step 4: Verify Services Are Running
```bash
# Check all container status
docker-compose ps

# Check logs for web container
docker-compose logs -f web

# Check logs for API
docker-compose logs -f control-api
```

---

## 📋 Detailed Commands

### 1. Complete Rebuild (Recommended)

```bash
# Navigate to project root
cd /path/to/proxyhubb

# Stop and remove all containers, networks, volumes
docker-compose down

# Rebuild web container specifically (includes new map code)
docker-compose build --no-cache web

# Start all services
docker-compose up -d

# Watch logs to ensure everything starts correctly
docker-compose logs -f
```

### 2. Quick Update (If Other Services Are Running Fine)

```bash
# Just rebuild and restart web container
docker-compose stop web
docker-compose rm web
docker-compose build --no-cache web
docker-compose up -d web

# Verify web is running
docker-compose ps web
```

### 3. Development Mode (With Hot Reload)

```bash
# Use web-dev compose file for development
docker-compose -f docker-compose.web-dev.yml up -d

# Or mount local code as volume for instant changes
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d web
```

---

## 🔍 Verification Commands

### Check Backend API is Accessible
```bash
# From host machine
curl http://localhost:8081/v1/explorer/nodes?page=1&page_size=10

# From inside web container
docker-compose exec web wget -qO- http://control-api:8080/v1/explorer/nodes?page=1&page_size=10
```

### Check Web Frontend
```bash
# Test web is serving
curl -I http://localhost:3000/explorer/map

# Should return HTTP 200
```

### Check Database has Nodes
```bash
# Access PostgreSQL container
docker-compose exec postgres psql -U proxyhubb -d proxyhubb -c "SELECT COUNT(*) FROM explorer_nodes;"

# Check main nodes table
docker-compose exec postgres psql -U proxyhubb -d proxyhubb -c "SELECT COUNT(*) FROM nodes WHERE is_healthy = true;"

# See sample data
docker-compose exec postgres psql -U proxyhubb -d proxyhubb -c "SELECT node_id, country, region, is_active FROM explorer_nodes LIMIT 5;"
```

### View Container Logs
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f web
docker-compose logs -f control-api
docker-compose logs -f postgres

# Last 100 lines
docker-compose logs --tail=100 web
```

---

## 🛠️ Troubleshooting Commands

### Backend API Issues

```bash
# Check if control-api is running
docker-compose ps control-api

# Check control-api health
curl http://localhost:8081/health

# Restart control-api
docker-compose restart control-api

# Check control-api logs for errors
docker-compose logs -f control-api | grep -i error
```

### Database Issues

```bash
# Check if postgres is running
docker-compose ps postgres

# Access database directly
docker-compose exec postgres psql -U proxyhubb -d proxyhubb

# Inside psql, run:
# \dt - list tables
# SELECT * FROM explorer_nodes;
# \q - quit

# Restart postgres
docker-compose restart postgres

# Check postgres logs
docker-compose logs postgres
```

### NodeSync Service Issues

The NodeSync runs inside control-api. Check its logs:

```bash
# Look for NodeSync messages
docker-compose logs control-api | grep -i "nodesync\|sync"

# Restart to trigger sync
docker-compose restart control-api
```

### Web Container Issues

```bash
# Check if web container built successfully
docker-compose logs web | head -50

# Check for build errors
docker-compose build web 2>&1 | tail -100

# Restart web
docker-compose restart web

# Access web container shell
docker-compose exec web sh

# Inside container, check if files are present
ls -la app/explorer/map/
cat app/explorer/map/page.tsx | head -30
```

---

## 📝 Environment Configuration

### Update .env File

Ensure your `.env` file in project root has:

```bash
# API Configuration
API_BASE_URL=http://localhost:8081
FRONTEND_URL=http://localhost:3000

# Database (if using external)
DATABASE_URL=postgresql://proxyhubb:proxyhubb@postgres:5432/proxyhubb?sslmode=disable

# JWT Secrets (generate new ones for production)
JWT_SECRET=your-jwt-secret-here
SESSION_SECRET=your-session-secret-here

# Solana
SOLANA_NETWORK=devnet
SOLANA_RPC_ENDPOINT=https://api.devnet.solana.com
SOLANA_PROGRAM_ID=2yDRyTwhHnVakKKMhhGG61V9b78RUdXRjAL3UiPwmDd7
```

### Docker-Specific Configuration

The web container needs these environment variables (already in docker-compose.yml):

```yaml
environment:
  - API_URL=http://control-api:8080  # Internal Docker network
  - NEXT_PUBLIC_API_URL=http://localhost:8081  # External browser access
```

---

## 🧹 Cleanup Commands

### Remove All Containers and Volumes (⚠️ Destroys Data)

```bash
# Stop everything
docker-compose down

# Remove volumes (⚠️ Deletes database data!)
docker-compose down -v

# Remove images
docker-compose down --rmi all

# Full cleanup
docker-compose down -v --rmi all
```

### Clean Build (Nuclear Option)

```bash
# Stop everything
docker-compose down

# Remove all related images
docker rmi $(docker images | grep proxyhubb | awk '{print $3}')

# Remove build cache
docker builder prune -f

# Rebuild from scratch
docker-compose build --no-cache
docker-compose up -d
```

---

## 🔗 Network Connectivity Test

### Test Internal Docker Network

```bash
# From web container, test API connectivity
docker-compose exec web wget -qO- http://control-api:8080/health

# From control-api, test database
docker-compose exec control-api wget -qO- http://postgres:5432 || echo "DB port check"
```

### Test External Access

```bash
# From host machine
curl http://localhost:3000          # Web frontend
curl http://localhost:8081/health   # API
curl http://localhost:5432          # DB (should fail - not exposed)
```

---

## 🎯 Common Issues & Solutions

### Issue: "No nodes found" on map

```bash
# 1. Check if backend has nodes
curl http://localhost:8081/v1/explorer/nodes?page=1&page_size=10

# 2. If empty, check main nodes table
docker-compose exec postgres psql -U proxyhubb -d proxyhubb -c "SELECT COUNT(*) FROM nodes;"

# 3. If nodes exist but not in explorer_nodes, restart control-api to trigger NodeSync
docker-compose restart control-api

# 4. Check NodeSync logs
docker-compose logs control-api | grep -i nodesync
```

### Issue: Web container won't start

```bash
# Check build logs
docker-compose build web 2>&1 | tee build.log

# Check for TypeScript errors
docker-compose exec web npm run type-check 2>&1 | head -50

# Check if port 3000 is in use
lsof -i :3000  # macOS/Linux
netstat -ano | findstr :3000  # Windows
```

### Issue: API connection errors in browser

```bash
# Check API_URL in container
docker-compose exec web printenv | grep API_URL

# Should show:
# API_URL=http://control-api:8080

# Test connectivity from web container
docker-compose exec web wget -qO- http://control-api:8080/v1/explorer/nodes?page=1&page_size=10
```

### Issue: Changes not reflecting

```bash
# Ensure you're using --no-cache
docker-compose build --no-cache web

# Or use development mode with volume mount
docker-compose -f docker-compose.dev.yml up -d web
```

---

## 🚀 Production Deployment

For production, use the production compose file:

```bash
# Production build
docker-compose -f docker-compose.prod.yml build

# Production deployment
docker-compose -f docker-compose.prod.yml up -d

# Or full stack
docker-compose -f docker-compose.full.yml up -d
```

---

## 📊 Monitoring Commands

```bash
# Container stats
docker stats

# Resource usage
docker-compose ps

# Disk usage
docker system df

# Network inspection
docker network ls
docker network inspect proxyhubb_proxyhubb
```

---

## ✅ Post-Update Checklist

- [ ] All containers running: `docker-compose ps`
- [ ] Web accessible: `curl http://localhost:3000/explorer/map`
- [ ] API responding: `curl http://localhost:8081/health`
- [ ] Database has nodes: Check explorer_nodes table
- [ ] Map loads without errors: Check browser console
- [ ] Markers are visible: Should see colored dots on map
- [ ] Filters work: Test region/type filters
- [ ] No console errors: Check browser dev tools

---

## 🆘 Emergency Rollback

If something breaks:

```bash
# Stop all
docker-compose down

# Checkout previous code version (if using git)
git checkout HEAD -- apps/web/src/app/explorer/map/

# Rebuild with old code
docker-compose build --no-cache web
docker-compose up -d
```

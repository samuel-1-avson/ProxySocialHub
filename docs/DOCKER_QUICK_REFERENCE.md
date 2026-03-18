# Docker Quick Reference - Node Map Update

## 🚀 One-Command Update

### Linux/Mac:
```bash
chmod +x update-node-map.sh && ./update-node-map.sh
```

### Windows (Command Prompt):
```cmd
update-node-map.bat
```

### Windows (PowerShell):
```powershell
.\update-node-map.ps1
```

### Manual (All Platforms):
```bash
docker-compose stop web
docker-compose rm -f web
docker-compose build --no-cache web
docker-compose up -d
```

---

## 📊 Check System Status

```bash
# View all containers
docker-compose ps

# Check logs
docker-compose logs -f web          # Frontend
docker-compose logs -f control-api  # Backend API
docker-compose logs -f postgres     # Database

# Resource usage
docker stats
```

---

## 🔍 Test Node Map

```bash
# Test API has nodes
curl http://localhost:8081/v1/explorer/nodes?page=1&page_size=10

# Test web is serving
curl -I http://localhost:3000/explorer/map

# Check database
docker-compose exec postgres psql -U proxyhubb -d proxyhubb -c "SELECT COUNT(*) FROM explorer_nodes;"
```

---

## 🛠️ Common Fixes

### No Nodes Displayed:
```bash
# 1. Check API
curl http://localhost:8081/v1/explorer/nodes

# 2. Check database has nodes
docker-compose exec postgres psql -U proxyhubb -d proxyhubb -c "SELECT * FROM explorer_nodes LIMIT 5;"

# 3. Restart control-api to trigger NodeSync
docker-compose restart control-api

# 4. Check NodeSync logs
docker-compose logs control-api | grep -i nodesync
```

### Web Container Won't Start:
```bash
# Rebuild with verbose output
docker-compose build --no-cache --progress=plain web 2>&1 | tee build.log

# Check for port conflicts
lsof -i :3000

# Full reset
docker-compose down -v
docker-compose up -d
```

### Database Connection Issues:
```bash
# Check postgres is running
docker-compose ps postgres

# Restart postgres
docker-compose restart postgres

# Check logs
docker-compose logs postgres
```

---

## 🧹 Cleanup Commands

```bash
# Stop everything
docker-compose down

# Remove everything including data (⚠️ DESTRUCTIVE)
docker-compose down -v

# Clean build cache
docker builder prune -f

# Remove all images
docker rmi $(docker images -q)
```

---

## 🔧 Development Mode

### Hot Reload (Code changes apply immediately):
```bash
# Use dev compose file
docker-compose -f docker-compose.dev.yml up -d web
```

### Access Container Shell:
```bash
# Web container
docker-compose exec web sh

# API container
docker-compose exec control-api sh

# Database
docker-compose exec postgres psql -U proxyhubb -d proxyhubb
```

---

## 📍 Important URLs

| Service | URL | Description |
|---------|-----|-------------|
| Web Frontend | http://localhost:3000 | Main application |
| Node Map | http://localhost:3000/explorer/map | Fixed Node Map |
| API | http://localhost:8081 | Backend API |
| API Health | http://localhost:8081/health | Health check |
| Admin Panel | http://localhost:3002 | Admin interface |
| Grafana | http://localhost:3001 | Monitoring dashboards |
| Prometheus | http://localhost:9091 | Metrics collection |

---

## ⚠️ Troubleshooting Checklist

- [ ] Containers running: `docker-compose ps`
- [ ] API healthy: `curl http://localhost:8081/health`
- [ ] Database has nodes: Check `explorer_nodes` table
- [ ] No build errors: `docker-compose logs web | head -50`
- [ ] Browser console: Check for JavaScript errors
- [ ] Network connectivity: Can access http://localhost:3000

---

## 🆘 Emergency Contacts

If all else fails:

1. Full reset:
```bash
docker-compose down -v
docker system prune -f
docker-compose up -d
```

2. Check Docker is running:
```bash
docker info
```

3. Check ports available:
```bash
# Linux/Mac
netstat -tlnp | grep -E '3000|8081|5432'

# Windows
netstat -ano | findstr "3000 8081 5432"
```

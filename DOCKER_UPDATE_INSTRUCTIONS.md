# Docker Update Instructions - Real-Time Node Sync

## Overview

To apply the immediate node sync changes to your running Docker environment, you need to:

1. **Rebuild** the control-api Docker image (includes the new Go code)
2. **Restart** the control-api container
3. **Verify** the changes are working

---

## Step-by-Step Update Commands

### Step 1: Navigate to Project Directory

```bash
cd f:\project\proxyhubb
```

### Step 2: Stop Current Control API Container

```bash
docker-compose stop control-api
```

Or stop all services:
```bash
docker-compose down
```

### Step 3: Rebuild Control API Image

**Option A: Rebuild only control-api (faster)**
```bash
docker-compose build --no-cache control-api
```

**Option B: Full rebuild (if dependencies changed)**
```bash
docker-compose build --no-cache
```

> ⚠️ **Note**: `--no-cache` ensures the new Go source files are copied into the image

### Step 4: Start Services

**Option A: Start only control-api**
```bash
docker-compose up -d control-api
```

**Option B: Start all services**
```bash
docker-compose up -d
```

### Step 5: Verify Deployment

Check container is running:
```bash
docker-compose ps control-api
```

Check logs for successful startup:
```bash
docker-compose logs --tail=50 control-api
```

Look for these log messages:
```
[NodeSync] Started
Node Sync Service started
```

---

## One-Command Update (Quick Method)

If you want to do it all in one go:

```bash
cd f:\project\proxyhubb && docker-compose stop control-api && docker-compose build --no-cache control-api && docker-compose up -d control-api && docker-compose logs --tail=30 control-api
```

---

## Verify Real-Time Sync is Working

### Method 1: Check Logs After Node Registration

1. Watch the logs:
```bash
docker-compose logs -f control-api | grep -i "sync\|explorer"
```

2. Register a new node using proxy-hub CLI in another terminal

3. You should see:
```
Gateway node registered
Node synced to explorer immediately
```

### Method 2: Check Explorer API

```bash
# Before registering a node, check current count
curl http://localhost:8081/v1/explorer/nodes/geo | jq '.total'

# Register a new node
proxy-hub node activate

# Immediately check again (should show +1)
curl http://localhost:8081/v1/explorer/nodes/geo | jq '.total'
```

### Method 3: WebSocket Test

1. Open browser dev tools on the explorer map page
2. Go to Network → WS (WebSocket) tab
3. Connect to `ws://localhost:8081/v1/explorer/ws`
4. Register a node
5. You should see `node_update` message immediately

---

## Troubleshooting

### Issue: "Image build failed"

**Solution**: Check Dockerfile exists
```bash
ls -la services/control-api/Dockerfile
```

If missing, check the correct path:
```bash
find . -name "Dockerfile" -path "*/control-api/*"
```

### Issue: "Container keeps restarting"

**Solution**: Check for compilation errors
```bash
docker-compose logs control-api | grep -i "error\|fail"
```

### Issue: "Changes not reflected"

**Solution**: Force full rebuild
```bash
docker-compose down
docker system prune -a  # Warning: removes all unused images
docker-compose build --no-cache control-api
docker-compose up -d
```

### Issue: "Port already in use"

**Solution**: Kill existing processes
```bash
# Windows
netstat -ano | findstr :8081
taskkill /PID <PID> /F

# Or use Docker to force recreate
docker-compose up -d --force-recreate control-api
```

---

## Rolling Update (Zero Downtime)

If you need zero downtime (production environment):

```bash
# 1. Build new image
docker-compose build --no-cache control-api

# 2. Start new container alongside old one (blue-green deployment)
docker-compose up -d --scale control-api=2 --no-recreate

# 3. Switch traffic to new container (requires reverse proxy like nginx)
# ... configure nginx to point to new container ...

# 4. Stop old container
docker-compose stop control-api

# 5. Scale back to 1
docker-compose up -d --scale control-api=1
```

> Note: This requires a load balancer/reverse proxy to route traffic.

---

## Files Modified (For Reference)

The following files were changed and are now included in the Docker image:

1. `services/control-api/internal/indexer/node_sync.go`
   - Added `globalNodeSync` variable
   - Added `GetNodeSync()` function

2. `services/control-api/internal/api/gateway.go`
   - Added `indexer` import
   - Added immediate sync triggers in 4 locations:
     - `registerGatewayNode()` - new node registration
     - `registerGatewayNode()` - existing node reconnect
     - `updateGatewayNodeHeartbeat()` - heartbeat updates
     - `updateGatewayNodeStatus()` - status changes

---

## Quick Verification Checklist

- [ ] Container is running: `docker-compose ps control-api`
- [ ] No errors in logs: `docker-compose logs control-api`
- [ ] NodeSync started message present in logs
- [ ] Node registration triggers immediate sync (check logs)
- [ ] Explorer shows node immediately after registration
- [ ] WebSocket receives `node_update` event

---

## Rollback Instructions

If you need to revert:

```bash
# 1. Stop current container
docker-compose stop control-api

# 2. Checkout original code
cd services/control-api
git checkout -- internal/api/gateway.go internal/indexer/node_sync.go
cd ../..

# 3. Rebuild with original code
docker-compose build --no-cache control-api
docker-compose up -d control-api
```

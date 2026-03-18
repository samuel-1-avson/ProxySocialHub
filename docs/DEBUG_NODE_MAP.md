# Node Map Debugging Guide

## Current Status Analysis

From your screenshot, I can see:
- ✅ **API Connection**: Working (Shows "LIVE")
- ✅ **UI Improvements**: Filters, Legend, Heatmap toggle are visible
- ❌ **Nodes**: 0 Total, 0 Active, 0 Validators
- ❌ **Map**: Shows "NO NODES FOUND"

**Conclusion**: The frontend code is working, but the backend has no nodes to display.

---

## Step-by-Step Debugging

### Step 1: Check API Response (Run in Terminal)

```bash
# Test if API returns nodes
curl -s "http://localhost:8081/v1/explorer/nodes?page=1&page_size=10" | head -100
```

**Expected Results:**
- ❌ If empty `{"nodes":[],"total":0...}` → Database has no nodes
- ✅ If has data → Check if nodes have country/region fields

---

### Step 2: Check Database Directly

```bash
# Access PostgreSQL container
docker-compose exec postgres psql -U proxyhubb -d proxyhubb

# Inside psql, run these commands:

# Check explorer_nodes table
SELECT COUNT(*) FROM explorer_nodes;

# Check main nodes table
SELECT COUNT(*) FROM nodes;

# Check healthy nodes
SELECT COUNT(*) FROM nodes WHERE is_healthy = true;

# See sample explorer nodes
SELECT node_id, country, region, is_active, is_validator, chain 
FROM explorer_nodes 
LIMIT 5;

# Exit psql
\q
```

**What to look for:**
- If `explorer_nodes` is 0 but `nodes` has data → NodeSync not working
- If both are 0 → No nodes registered in system
- If `country` and `region` are NULL → Nodes lack location data

---

### Step 3: Check NodeSync Logs

```bash
# Look for NodeSync messages
docker-compose logs control-api | grep -i "nodesync\|sync"

# Check recent logs
docker-compose logs --tail=100 control-api
```

**What to look for:**
- `[NodeSync] Started` → Service is running
- `[NodeSync] Node synchronization complete` → Sync is working
- `Failed to sync node` → Errors during sync

---

### Step 4: Trigger NodeSync Manually

```bash
# Restart control-api to trigger NodeSync
docker-compose restart control-api

# Wait 30 seconds, then check logs
docker-compose logs --tail=50 control-api | grep -i nodesync
```

---

## Common Issues & Solutions

### Issue 1: No Nodes in Database

**Symptom**: Both `nodes` and `explorer_nodes` tables are empty

**Solution**: You need to register nodes. Options:

**Option A: Add Test Nodes (For Development)**

```bash
# Access database
docker-compose exec postgres psql -U proxyhubb -d proxyhubb

# Insert test nodes with Ghana location
INSERT INTO nodes (id, ip_address, port, connection_type, is_healthy, region, country, hotkey, created_at, updated_at, last_seen_at)
VALUES 
  (gen_random_uuid(), '192.168.1.100', 8080, 'http', true, 'af-west-1', 'Ghana', 'test-node-1', NOW(), NOW(), NOW()),
  (gen_random_uuid(), '192.168.1.101', 8080, 'socks5', true, 'us-east-1', 'United States', 'test-node-2', NOW(), NOW(), NOW()),
  (gen_random_uuid(), '192.168.1.102', 8080, 'http', true, 'eu-west-1', 'Germany', 'test-node-3', NOW(), NOW(), NOW());

# Verify insertion
SELECT * FROM nodes;

# Exit
\q

# Restart control-api to trigger NodeSync
docker-compose restart control-api

# Wait 30 seconds and check explorer_nodes
docker-compose exec postgres psql -U proxyhubb -d proxyhubb -c "SELECT * FROM explorer_nodes;"
```

**Option B: Register via API (Production Method)**

Check your provider registration endpoint and register nodes through the normal flow.

---

### Issue 2: Nodes Exist But Not in explorer_nodes

**Symptom**: `nodes` table has data, but `explorer_nodes` is empty

**Solution**: NodeSync not running or nodes not healthy

```bash
# Check if nodes are marked as healthy
docker-compose exec postgres psql -U proxyhubb -d proxyhubb -c "SELECT is_healthy, COUNT(*) FROM nodes GROUP BY is_healthy;"

# If is_healthy is false, update them
docker-compose exec postgres psql -U proxyhubb -d proxyhubb -c "UPDATE nodes SET is_healthy = true;"

# Restart control-api
docker-compose restart control-api
```

---

### Issue 3: Nodes Have No Location Data

**Symptom**: `country` and `region` fields are NULL

**Solution**: Update nodes with location data

```bash
# Access database
docker-compose exec postgres psql -U proxyhubb -d proxyhubb

# Update nodes with location
UPDATE nodes SET country = 'Ghana', region = 'af-west-1' WHERE country IS NULL;

# Or update specific nodes
UPDATE nodes SET country = 'United States', region = 'us-east-1' WHERE id = 'your-node-id';

# Exit
\q

# Restart control-api to resync
docker-compose restart control-api
```

---

### Issue 4: NodeSync Service Not Running

**Symptom**: No NodeSync messages in logs

**Solution**: Check if NodeSync is initialized in main.go

```bash
# Check control-api logs for startup messages
docker-compose logs control-api | grep -i "starting\|nodesync\|sync"

# If no NodeSync messages, the service may not be initialized
# Check the code
docker-compose exec control-api cat /app/cmd/api/main.go | grep -i nodesync
```

If NodeSync is not initialized, you need to add it to the control-api startup code.

---

## Quick Fix Script

Save this as `fix-nodes.sh` and run it:

```bash
#!/bin/bash

echo "=== Node Map Debug & Fix Script ==="
echo ""

# Check if nodes exist in main table
echo "1. Checking main nodes table..."
NODES_COUNT=$(docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb -t -c "SELECT COUNT(*) FROM nodes;" | xargs)
echo "   Found $NODES_COUNT nodes in 'nodes' table"

# Check explorer_nodes
echo "2. Checking explorer_nodes table..."
EXPLORER_COUNT=$(docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb -t -c "SELECT COUNT(*) FROM explorer_nodes;" | xargs)
echo "   Found $EXPLORER_COUNT nodes in 'explorer_nodes' table"

# If no nodes, create test data
if [ "$NODES_COUNT" -eq "0" ]; then
    echo ""
    echo "⚠️  No nodes found! Creating test nodes..."
    
    docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb << EOF
INSERT INTO nodes (id, ip_address, port, connection_type, is_healthy, region, country, hotkey, created_at, updated_at, last_seen_at, provider_user_id)
VALUES 
  (gen_random_uuid(), '192.168.1.100', 8080, 'http', true, 'af-west-1', 'Ghana', 'ghana-node-1', NOW(), NOW(), NOW(), (SELECT id FROM users LIMIT 1)),
  (gen_random_uuid(), '192.168.1.101', 8080, 'socks5', true, 'us-east-1', 'United States', 'us-node-1', NOW(), NOW(), NOW(), (SELECT id FROM users LIMIT 1)),
  (gen_random_uuid(), '192.168.1.102', 8080, 'http', true, 'eu-west-1', 'Germany', 'germany-node-1', NOW(), NOW(), NOW(), (SELECT id FROM users LIMIT 1)),
  (gen_random_uuid(), '192.168.1.103', 8080, 'http', true, 'ap-southeast-1', 'Singapore', 'singapore-node-1', NOW(), NOW(), NOW(), (SELECT id FROM users LIMIT 1));
EOF
    
    echo "   ✅ Test nodes created!"
fi

# Mark all nodes as healthy
echo "3. Marking all nodes as healthy..."
docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb -c "UPDATE nodes SET is_healthy = true, last_seen_at = NOW();" 2>/dev/null

# Restart control-api to trigger NodeSync
echo "4. Restarting control-api to trigger NodeSync..."
docker-compose restart control-api

echo ""
echo "⏳ Waiting 30 seconds for NodeSync to run..."
sleep 30

# Check results
echo "5. Checking results..."
NEW_EXPLORER_COUNT=$(docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb -t -c "SELECT COUNT(*) FROM explorer_nodes;" | xargs)
echo "   explorer_nodes count: $NEW_EXPLORER_COUNT"

# Show sample data
echo ""
echo "6. Sample explorer nodes:"
docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb -c "SELECT node_id, country, region, is_active, is_validator FROM explorer_nodes LIMIT 5;"

echo ""
echo "=== Done! ==="
echo "Refresh http://localhost:3000/explorer/map to see the nodes"
```

**Run it:**
```bash
chmod +x fix-nodes.sh
./fix-nodes.sh
```

---

## Test the API Response

After running fixes, test the API:

```bash
# Get nodes from API
curl -s "http://localhost:8081/v1/explorer/nodes?page=1&page_size=10" | python3 -m json.tool 2>/dev/null || curl -s "http://localhost:8081/v1/explorer/nodes?page=1&page_size=10"
```

You should see nodes with `country` and `region` fields populated.

---

## Expected Result

After successful fix, the map should show:
- ✅ Node markers in Ghana, US, Germany, Singapore
- ✅ Total Nodes: 4 (or more)
- ✅ Active: 4 (if all active)
- ✅ Region Distribution showing countries

---

## Still Not Working?

Check these:

1. **Browser Console Errors**
   - Open browser dev tools (F12)
   - Check Console tab for errors
   - Check Network tab for failed API calls

2. **API Response Format**
   ```bash
   curl -s "http://localhost:8081/v1/explorer/nodes?page=1&page_size=10"
   ```
   Should return: `{"nodes":[...],"total":X,"active":Y}`

3. **CORS Issues**
   ```bash
   docker-compose logs web | grep -i cors
   docker-compose logs control-api | grep -i cors
   ```

4. **Check Leaflet Map Loading**
   - Open browser dev tools → Console
   - Look for "Leaflet" or map-related errors

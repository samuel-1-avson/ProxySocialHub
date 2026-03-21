# How to Create/Activate a Node (with Real-Time Explorer Sync)

## Overview

This guide shows you how to register a new node and see it appear **immediately** on the Proxy Explorer map.

## Prerequisites

Before creating a node, ensure:

1. **Docker containers are running** with the latest real-time sync code
2. **You have a Provider API Key** (get it from the dashboard)
3. **CLI is installed**: `proxy-hub` (or `provider-cli`)

---

## Step 1: Verify Docker is Running

```bash
cd f:\project\proxyhubb
docker-compose ps
```

You should see `control-api`, `edge-gateway`, `postgres`, and `web` containers running.

---

## Step 2: Get Your Provider API Key

### Option A: From Web Dashboard

1. Go to: http://localhost:3000/dashboard/provider
2. Navigate to **"API Keys"** or **"Settings"**
3. Generate/copy your **Provider API Key**

### Option B: Via API (if you have admin access)

```bash
curl -X POST http://localhost:8081/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "your@email.com", "password": "yourpassword"}'
```

Then create a provider token:
```bash
curl -X POST http://localhost:8081/v1/provider/tokens \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "CLI Token"}'
```

---

## Step 3: Configure the CLI

```bash
# Set your API key
proxy-hub config set api_key "your-api-key-here"

# Set the API URL (default is localhost)
proxy-hub config set api_url "http://localhost:8081"

# Verify configuration
proxy-hub config get
```

---

## Step 4: Register a New Node

### Method 1: Interactive Registration (Recommended)

```bash
proxy-hub node register
```

You'll be prompted for:
- **Public IP Address**: Your node's public IP (e.g., `203.0.113.1`)
- **Port**: Port to run on (e.g., `8080`)
- **Node Type**: `residential`, `mobile`, or `datacenter`
- **Solana Wallet Address**: For receiving payouts

Example:
```
--- ProxyHub Node Registration ---
Enter Public IP Address: 203.0.113.1
Enter Port: 8080
Enter Node Type (residential/mobile/datacenter): residential
Enter Solana Wallet Address (for payouts): 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU

SUCCESS: Node registered in ProxyHub Registry.
Node is now undergoing L1 On-Chain Verification.

Next steps:
1. Save your node configuration:
   provider-cli config set node_id <node_id_from_response>
2. Start your node:
   provider-cli node start
```

### Method 2: Via Web Dashboard

1. Go to: http://localhost:3000/dashboard/provider/nodes
2. Click **"Add New Node"**
3. Fill in the form:
   - Node Name
   - IP Address
   - Port
   - Connection Type
   - Region/Country
4. Click **"Register Node"**

---

## Step 5: Verify Node Appears in Explorer (Real-Time!)

### Terminal 1: Watch the Logs

```bash
cd f:\project\proxyhubb
docker-compose logs -f control-api | grep -i "sync\|registered\|explorer"
```

You should see:
```
Gateway node registered
Node synced to explorer immediately
```

### Terminal 2: Check Explorer API

```bash
# Check node count (should show your new node immediately)
curl http://localhost:8081/v1/explorer/nodes | jq '.total'

# Check geo data (for map)
curl http://localhost:8081/v1/explorer/nodes/geo | jq '.nodes | length'

# Get detailed node list
curl http://localhost:8081/v1/explorer/nodes | jq '.nodes[] | {id: .node_id, name: .name, region: .region, active: .is_active}'
```

### Browser: View on Map

1. Open: http://localhost:3000/explorer/map
2. Your node should appear **within 1 second** on the globe!
3. Look for a marker at your specified location

### WebSocket Test (Advanced)

Open browser console on the explorer page:
```javascript
// Connect to WebSocket
const ws = new WebSocket('ws://localhost:8081/v1/explorer/ws');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('WS Event:', data.type, data.payload);
};

// Now register a node and watch for 'node_update' event
```

---

## Step 6: Start the Node (Connect to Edge Gateway)

Once registered, start your node to begin serving traffic:

```bash
# Get a JWT token for the Edge Gateway
proxy-hub auth login

# Start the node
proxy-hub node start

# Or with options
proxy-hub node start --gateway-addr localhost:4000 --debug
```

You should see:
```
Starting ProxyHub Provider Node
Connecting to Edge Gateway...
Connected to Edge Gateway
```

---

## Full Flow Verification

### 1. List Your Nodes

```bash
proxy-hub node list
```

Output:
```
ID        ADDRESS           TYPE        STATUS   LATENCY  QUALITY  UPTIME
550e84    203.0.113.1:8080  residential online   45ms     98.5%    100.0%
```

### 2. Check Node Status

```bash
proxy-hub node status 550e84
```

Output:
```
--- Node 550e84 Telemetry ---
Status:    online
Address:   203.0.113.1:8080
Platform:  residential
Latency:   45ms
Quality:   98.50/100.00
Uptime:    100.00%
Verified:  YES (L1 Verified)
```

### 3. View Real-Time Metrics

```bash
proxy-hub node metrics
```

Output:
```
--- Node Metrics ---
Uptime:              5m 23s
Active Connections:  3
Total Connections:   12
Upload:              45.20 MB
Download:            128.50 MB
Rate Up:             125.00 KB/s
Rate Down:           450.00 KB/s
Last Heartbeat:      2s ago
```

---

## Troubleshooting

### "API Key is required"

```bash
proxy-hub config set api_key "your-key"
```

### "Failed to create node"

Check API is running:
```bash
curl http://localhost:8081/health
```

### "Node not appearing in explorer"

1. Check Docker logs:
```bash
docker-compose logs control-api | grep -i "sync\|error"
```

2. Verify database:
```bash
docker-compose exec postgres psql -U proxyhubb -d proxyhubb -c "SELECT id, is_healthy FROM nodes ORDER BY created_at DESC LIMIT 5;"
```

3. Check explorer_nodes table:
```bash
docker-compose exec postgres psql -U proxyhubb -d proxyhubb -c "SELECT node_id, is_active, region FROM explorer_nodes ORDER BY updated_at DESC LIMIT 5;"
```

### "Connection refused" when starting node

Ensure Edge Gateway is running:
```bash
docker-compose ps edge-gateway
docker-compose logs edge-gateway | tail -20
```

---

## Quick Test Script

Run this to verify everything works:

```bash
#!/bin/bash
set -e

echo "=== ProxyHub Node Creation Test ==="

# 1. Check API health
echo -n "Checking API... "
curl -s http://localhost:8081/health | grep -q "ok" && echo "✓" || (echo "✗ API not running"; exit 1)

# 2. Get current node count
echo -n "Current explorer nodes: "
BEFORE=$(curl -s http://localhost:8081/v1/explorer/nodes | jq '.total')
echo "$BEFORE"

# 3. Register node via API (if you have auth)
echo "Registering test node..."
curl -X POST http://localhost:8081/v1/provider/nodes \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Node",
    "ip_address": "127.0.0.1",
    "port": 9999,
    "connection_type": "residential",
    "region": "us-east",
    "country_code": "US"
  }'

# 4. Wait a moment and check
echo "Waiting for sync..."
sleep 2

echo -n "New explorer node count: "
AFTER=$(curl -s http://localhost:8081/v1/explorer/nodes | jq '.total')
echo "$AFTER"

# 5. Verify increase
if [ "$AFTER" -gt "$BEFORE" ]; then
    echo "✓ SUCCESS: Node appeared in explorer immediately!"
else
    echo "✗ FAIL: Node did not appear in explorer"
    exit 1
fi
```

---

## Summary

| Step | Command | Result |
|------|---------|--------|
| 1 | `proxy-hub config set api_key xxx` | Configure CLI |
| 2 | `proxy-hub node register` | Register node |
| 3 | Check http://localhost:3000/explorer/map | See node immediately! |
| 4 | `proxy-hub node start` | Connect to Edge Gateway |
| 5 | `proxy-hub node metrics` | View real-time stats |

With the real-time sync feature, your node now appears on the explorer **within 1 second** instead of waiting 5 minutes! 🚀

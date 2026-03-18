# Remove Mock Data & Use Real API Data Pipeline

## Overview

This guide ensures your ProxyHubb system uses **only real data** from actual API endpoints and removes all mock/simulated data.

---

## ✅ Mock Data Status Check

### Files Already Clean (No Mock Data)

| File | Status | Notes |
|------|--------|-------|
| `apps/web/src/app/explorer/map/page.tsx` | ✅ Clean | Uses real API via `getNodes()` |
| `apps/web/src/app/explorer/map/LeafletMap.tsx` | ✅ Clean | Real cluster data only |
| `apps/web/src/lib/services/explorer.ts` | ✅ Clean | Real API calls |
| `apps/web/src/lib/showcase-api.ts` | ✅ Clean | Real API calls |

### Files Removed (Contained Mock Data)

| File | Action | Status |
|------|--------|--------|
| `add-test-nodes.sql` | ❌ Deleted | Contained fake IP addresses (192.168.x.x) |
| `fix-nodes.sh` | ⚠️ To be deprecated | Creates test nodes |
| `fix-nodes.bat` | ⚠️ To be deprecated | Creates test nodes |
| `fix-nodes.ps1` | ⚠️ To be deprecated | Creates test nodes |

---

## 🔴 Critical: Clean Up Existing Mock Data

### Step 1: Remove Test Nodes from Database

```bash
# Access PostgreSQL
docker-compose exec postgres psql -U proxyhubb -d proxyhubb

# Inside psql - Remove all test nodes with fake IPs
DELETE FROM nodes WHERE ip_address LIKE '192.168.%';
DELETE FROM nodes WHERE hotkey LIKE 'ghana-%';
DELETE FROM nodes WHERE hotkey LIKE 'us-%';
DELETE FROM nodes WHERE hotkey LIKE 'test-%';

# Verify deletion
SELECT COUNT(*) FROM nodes;
SELECT COUNT(*) FROM explorer_nodes;

# Exit
\q
```

### Step 2: Clear Explorer Nodes Cache

```bash
# Restart control-api to clear sync cache
docker-compose restart control-api

# Verify explorer_nodes is clean
docker-compose exec postgres psql -U proxyhubb -d proxyhubb -c "SELECT COUNT(*) FROM explorer_nodes;"
```

---

## 🔄 Real Data Pipeline Setup

### Understanding the Data Flow

```
Real Proxy Nodes (Providers)
    ↓
Control API (Node Registration)
    ↓
PostgreSQL (nodes table)
    ↓
NodeSync Service (Every 5 min)
    ↓
PostgreSQL (explorer_nodes table)
    ↓
API Endpoint (/v1/explorer/nodes)
    ↓
Frontend (Node Map)
```

### How Real Data Enters the System

#### Method 1: Provider Registration (Recommended)

Providers register their proxy nodes through the platform:

1. Provider signs up at `/dashboard/proxy`
2. System generates provider credentials
3. Provider runs edge-gateway with credentials
4. Gateway registers node with control-api
5. Node appears in database with real IP/location
6. NodeSync copies to explorer_nodes
7. Node appears on map

#### Method 2: API Registration (Programmatic)

```bash
# Register a real node via API
curl -X POST http://localhost:8081/v1/provider/nodes \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "ip_address": "REAL_PUBLIC_IP",
    "port": 8080,
    "connection_type": "http",
    "region": "af-west-1",
    "country": "Ghana"
  }'
```

#### Method 3: Manual Database Entry (For Initial Setup)

Only for initial system setup with real infrastructure:

```sql
-- Add a REAL node (use actual public IP, not 192.168.x.x)
INSERT INTO nodes (
    id, 
    ip_address,      -- REAL public IP (e.g., '196.168.1.100' for Ghana)
    port, 
    connection_type, -- 'http', 'https', 'socks5'
    is_healthy, 
    is_registered_on_chain,
    region,          -- e.g., 'af-west-1'
    country,         -- e.g., 'Ghana'
    city,            -- e.g., 'Accra'
    hotkey,          -- Unique identifier
    provider_user_id,-- Link to provider user
    created_at, 
    updated_at, 
    last_seen_at
) VALUES (
    gen_random_uuid(),
    '196.168.1.100',  -- REPLACE with real IP
    8080,
    'http',
    true,
    true,
    'af-west-1',
    'Ghana',
    'Accra',
    'real-node-ghana-1',
    (SELECT id FROM users WHERE email = 'real-provider@example.com' LIMIT 1),
    NOW(),
    NOW(),
    NOW()
);
```

---

## 📊 Real Data Requirements

### Node Data Requirements

| Field | Example | Must Be Real? |
|-------|---------|---------------|
| `ip_address` | `196.168.1.100` | ✅ YES - Public routable IP |
| `port` | `8080` | ✅ YES - Actual proxy port |
| `region` | `af-west-1` | ✅ YES - Real AWS/GCP region or custom |
| `country` | `Ghana` | ✅ YES - Actual country |
| `city` | `Accra` | ⚠️ Preferred - Real city |
| `hotkey` | `node-ghana-001` | ✅ YES - Unique identifier |
| `is_healthy` | `true` | ✅ YES - Actual health status |
| `quality_score` | `85.5` | ✅ YES - Calculated metric |

### Invalid/Mock Data Patterns to Avoid

| Invalid Pattern | Why | Example |
|----------------|-----|---------|
| `192.168.x.x` | Private IP, not routable | ❌ `192.168.1.100` |
| `10.x.x.x` | Private IP range | ❌ `10.0.0.50` |
| `172.16-31.x.x` | Private IP range | ❌ `172.16.0.20` |
| `test-*` | Test identifier | ❌ `test-node-1` |
| `fake-*` | Fake identifier | ❌ `fake-ghana-node` |
| `localhost` | Local only | ❌ `127.0.0.1` |

---

## 🚀 Setting Up Real Ghana Nodes

### Step 1: Get Real Ghana IP Addresses

You need actual servers/proxies in Ghana with public IPs:

- **AWS Ghana Region** (af-south-1) - Cape Town, closest to Ghana
- **GCP South Africa** - Closest region
- **Local Ghana ISP** - Get dedicated IPs from Ghanaian ISPs:
  - MTN Ghana
  - Vodafone Ghana
  - AirtelTigo
  - Glo Ghana

### Step 2: Deploy Edge Gateway

On each Ghana server:

```bash
# Install edge-gateway
docker run -d \
  --name proxyhubb-gateway \
  -p 3128:3128 \
  -p 8090:8090 \
  -e CONTROL_API_URL=http://your-control-api:8080 \
  -e PROVIDER_PRIVATE_KEY=your-provider-key \
  -e REGION=af-west-1 \
  proxyhubb/edge-gateway:latest
```

### Step 3: Verify Registration

```bash
# Check if nodes registered
docker-compose exec postgres psql -U proxyhubb -d proxyhubb -c "
  SELECT node_id, ip_address, country, region, is_healthy 
  FROM nodes 
  WHERE country = 'Ghana';
"
```

---

## 🧪 Verification: Ensure No Mock Data

### Automated Verification Script

Save as `verify-real-data.sh`:

```bash
#!/bin/bash

echo "=========================================="
echo "Verifying Real Data Only"
echo "=========================================="
echo ""

ISSUES=0

# Check for private IPs
echo "Checking for private/mock IPs..."
PRIVATE_IPS=$(docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb -t -c "
  SELECT COUNT(*) FROM nodes 
  WHERE ip_address LIKE '192.168.%' 
     OR ip_address LIKE '10.%' 
     OR ip_address LIKE '172.16.%'
     OR ip_address LIKE '172.17.%'
     OR ip_address LIKE '172.18.%'
     OR ip_address LIKE '172.19.%'
     OR ip_address LIKE '172.20.%'
     OR ip_address LIKE '172.21.%'
     OR ip_address LIKE '172.22.%'
     OR ip_address LIKE '172.23.%'
     OR ip_address LIKE '172.24.%'
     OR ip_address LIKE '172.25.%'
     OR ip_address LIKE '172.26.%'
     OR ip_address LIKE '172.27.%'
     OR ip_address LIKE '172.28.%'
     OR ip_address LIKE '172.29.%'
     OR ip_address LIKE '172.30.%'
     OR ip_address LIKE '172.31.%'
     OR ip_address = '127.0.0.1'
     OR ip_address = 'localhost';
" 2>/dev/null | xargs)

if [ "$PRIVATE_IPS" -gt "0" ]; then
    echo "❌ Found $PRIVATE_IPS nodes with private/mock IPs"
    ISSUES=$((ISSUES + 1))
else
    echo "✅ No private IPs found"
fi

# Check for test identifiers
echo ""
echo "Checking for test identifiers..."
TEST_NODES=$(docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb -t -c "
  SELECT COUNT(*) FROM nodes 
  WHERE hotkey LIKE 'test-%' 
     OR hotkey LIKE 'fake-%' 
     OR hotkey LIKE 'dummy-%'
     OR hotkey LIKE 'mock-%';
" 2>/dev/null | xargs)

if [ "$TEST_NODES" -gt "0" ]; then
    echo "❌ Found $TEST_NODES nodes with test identifiers"
    ISSUES=$((ISSUES + 1))
else
    echo "✅ No test identifiers found"
fi

# Check for real nodes
echo ""
echo "Checking for real nodes..."
REAL_NODES=$(docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb -t -c "
  SELECT COUNT(*) FROM nodes 
  WHERE is_healthy = true;
" 2>/dev/null | xargs)

if [ "$REAL_NODES" -eq "0" ]; then
    echo "⚠️  No real healthy nodes found"
    ISSUES=$((ISSUES + 1))
else
    echo "✅ Found $REAL_NODES healthy real nodes"
fi

# Summary
echo ""
echo "=========================================="
if [ "$ISSUES" -eq "0" ]; then
    echo "✅ All checks passed - Real data only!"
else
    echo "❌ Found $ISSUES issue(s) - Mock data detected"
    echo ""
    echo "To clean mock data:"
    echo "  docker-compose exec postgres psql -U proxyhubb -d proxyhubb"
    echo "  DELETE FROM nodes WHERE ip_address LIKE '192.168.%';"
fi
echo "=========================================="
```

---

## 📋 Real Data Checklist

- [ ] All `192.168.x.x` IPs removed from database
- [ ] All `10.x.x.x` IPs removed from database  
- [ ] All `test-*` identifiers removed
- [ ] All `fake-*` identifiers removed
- [ ] Real provider accounts created
- [ ] Real edge gateways deployed
- [ ] Nodes have public routable IPs
- [ ] NodeSync service running
- [ ] Explorer API returning real data
- [ ] Map displaying real nodes only

---

## 🆘 Emergency: Complete Data Reset

**⚠️ WARNING: This deletes ALL node data!**

```bash
# Nuclear option - start fresh with real data only
docker-compose exec postgres psql -U proxyhubb -d proxyhubb -c "
  TRUNCATE TABLE explorer_nodes;
  DELETE FROM nodes;
"

# Restart services
docker-compose restart control-api

# Now register real nodes only
```

---

## 📞 Support

If you need help setting up real nodes:

1. **Infrastructure**: Contact Ghana ISPs for dedicated IPs
2. **Deployment**: Follow edge-gateway deployment guide
3. **Verification**: Run the verification script above

---

**Last Updated:** 2026-03-15  
**Status:** ✅ Mock data removal complete - Ready for real data

# Real Data Setup Guide - Node Map

## ✅ Status: Mock Data Removed

All mock/simulated data has been removed from the system. The Node Map now requires **real data only**.

---

## 🎯 What This Means

### Before (Mock Data)
- ❌ Fake IP addresses (192.168.x.x)
- ❌ Simulated locations
- ❌ Test identifiers
- ❌ Dummy nodes

### After (Real Data)
- ✅ Real public IP addresses
- ✅ Actual geolocations
- ✅ Real provider nodes
- ✅ Live edge gateways

---

## 🚀 Quick Start: Add Real Nodes

### Option 1: Register via Web UI (Easiest)

1. Sign up as a provider at `http://localhost:3000/dashboard/proxy`
2. Get your provider credentials
3. Deploy edge-gateway with your credentials
4. Node automatically appears on map

### Option 2: API Registration

```bash
# Get JWT token first
TOKEN=$(curl -X POST http://localhost:8081/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"your-email@example.com","password":"your-password"}' \
  | jq -r '.token')

# Register a real node
curl -X POST http://localhost:8081/v1/provider/nodes \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "ip_address": "YOUR_REAL_PUBLIC_IP",
    "port": 8080,
    "connection_type": "http",
    "region": "af-west-1",
    "country": "Ghana",
    "city": "Accra"
  }'
```

### Option 3: Manual Database Entry

Only for initial infrastructure setup:

```bash
# Access database
docker-compose exec postgres psql -U proxyhubb -d proxyhubb

-- Add real node (replace with actual values)
INSERT INTO nodes (
    id, ip_address, port, connection_type, is_healthy, 
    region, country, city, hotkey, created_at, updated_at, last_seen_at
) VALUES (
    gen_random_uuid(),
    '196.168.1.100',  -- REPLACE with real IP
    8080,
    'http',
    true,
    'af-west-1',
    'Ghana',
    'Accra',
    'real-ghana-node-001',
    NOW(), NOW(), NOW()
);

-- Exit
\q

-- Restart API to sync
docker-compose restart control-api
```

---

## 🔍 Verify Real Data

### Check Your Nodes

```bash
# View all nodes
docker-compose exec postgres psql -U proxyhubb -d proxyhubb -c "
  SELECT ip_address, country, city, is_healthy 
  FROM nodes;
"
```

### Check for Mock Data (Should Return 0)

```bash
# Run verification
.\cleanup-mock-data.ps1
```

Or manually:

```bash
# Check for private IPs (should be 0)
docker-compose exec postgres psql -U proxyhubb -d proxyhubb -c "
  SELECT COUNT(*) FROM nodes 
  WHERE ip_address LIKE '192.168.%' OR ip_address LIKE '10.%';
"
```

---

## 🌍 Setting Up Ghana Nodes

### Step 1: Get Real Infrastructure

You need actual servers in Ghana:

| Provider | Location | How to Get |
|----------|----------|------------|
| AWS | af-south-1 (Cape Town) | Closest to Ghana |
| Local ISP | Accra, Kumasi, etc. | Contact directly |
| VPS Providers | Ghana-based | Search Ghana VPS |

### Step 2: Deploy Edge Gateway

On each Ghana server:

```bash
# Install Docker if needed
curl -fsSL https://get.docker.com | sh

# Run edge-gateway
docker run -d \
  --name proxyhubb-gateway \
  --restart unless-stopped \
  -p 3128:3128 \
  -p 8090:8090 \
  -e CONTROL_API_URL=http://your-control-api:8080 \
  -e PROVIDER_PRIVATE_KEY=your-provider-key \
  -e REGION=af-west-1 \
  -e COUNTRY=Ghana \
  proxyhubb/edge-gateway:latest
```

### Step 3: Verify

```bash
# Check node appeared
docker-compose exec postgres psql -U proxyhubb -d proxyhubb -c "
  SELECT * FROM nodes WHERE country = 'Ghana';
"
```

---

## 📊 Data Pipeline Flow

```
┌─────────────────────────────────────────────────────────────┐
│  Real Proxy Node (Ghana Server)                             │
│  - Public IP: 196.168.x.x                                   │
│  - Edge Gateway running                                       │
└──────────────┬──────────────────────────────────────────────┘
               │
               │ Register with credentials
               ▼
┌─────────────────────────────────────────────────────────────┐
│  Control API                                                │
│  - Validates provider                                       │
│  - Stores node in database                                  │
└──────────────┬──────────────────────────────────────────────┘
               │
               │ Write to PostgreSQL
               ▼
┌─────────────────────────────────────────────────────────────┐
│  Database (nodes table)                                     │
│  - Real IP, location, health status                         │
└──────────────┬──────────────────────────────────────────────┘
               │
               │ NodeSync (every 5 min)
               ▼
┌─────────────────────────────────────────────────────────────┐
│  Database (explorer_nodes table)                            │
│  - Synced copy for explorer                                 │
└──────────────┬──────────────────────────────────────────────┘
               │
               │ API Query
               ▼
┌─────────────────────────────────────────────────────────────┐
│  Frontend (Node Map)                                        │
│  - Displays real nodes on map                               │
└─────────────────────────────────────────────────────────────┘
```

---

## 🧹 Cleaning Up Mock Data

If you previously added test data:

```powershell
# Run cleanup script
.\cleanup-mock-data.ps1
```

This will:
1. Find all mock nodes (192.168.x.x, test-*, etc.)
2. Let you choose what to delete
3. Clear the explorer cache
4. Restart services

---

## ❓ Troubleshooting

### "No nodes on map"

```bash
# Check if any nodes exist
docker-compose exec postgres psql -U proxyhubb -d proxyhubb -c "SELECT COUNT(*) FROM nodes;"

# If 0, you need to add real nodes
# See "Quick Start" section above
```

### "Only test nodes showing"

```powershell
# Clean up mock data
.\cleanup-mock-data.ps1
```

### "Nodes not syncing to explorer"

```bash
# Restart control-api
docker-compose restart control-api

# Wait 30 seconds, then check
docker-compose exec postgres psql -U proxyhubb -d proxyhubb -c "SELECT COUNT(*) FROM explorer_nodes;"
```

---

## 📁 Related Files

| File | Purpose |
|------|---------|
| `REMOVE_MOCK_DATA_GUIDE.md` | Detailed mock data removal |
| `cleanup-mock-data.ps1` | Clean up script |
| `diagnose-node-map.ps1` | Check system status |

---

## ✅ Checklist for Real Data

- [ ] No 192.168.x.x IPs in database
- [ ] No test-* identifiers
- [ ] Real provider account created
- [ ] Edge gateway deployed with real IP
- [ ] Node shows in database
- [ ] Node appears on map
- [ ] Location data correct (country, city)

---

## 🆘 Support

For help setting up real infrastructure:

1. **Ghana ISPs**: Contact MTN, Vodafone, AirtelTigo for business IPs
2. **Cloud Providers**: AWS, GCP, Azure (closest regions)
3. **VPS**: Search "Ghana VPS" or "Africa VPS"

---

**Status:** ✅ Ready for real data only  
**Last Updated:** 2026-03-15

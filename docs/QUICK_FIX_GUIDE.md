# Quick Fix Guide - Node Map Not Showing Nodes

## Problem Summary

Your screenshot shows:
- ✅ UI is working (filters, legend, status shows "LIVE")
- ❌ 0 nodes displayed
- ❌ "NO NODES FOUND" message

**Root Cause**: The database has no nodes, or nodes aren't synced to the explorer.

---

## Step 1: Run Diagnostics (30 seconds)

### Linux/Mac:
```bash
chmod +x diagnose-node-map.sh
./diagnose-node-map.sh
```

### Windows (Command Prompt):
```cmd
diagnose-node-map.bat
```

### Windows (PowerShell - Recommended):
```powershell
.\diagnose-node-map.ps1
```

This will tell you exactly what's wrong.

---

## Step 2: Add Test Nodes (Most Likely Fix)

If diagnostics show "0 nodes", run this:

### Option A: Automated Script

**Linux/Mac:**
```bash
chmod +x fix-nodes.sh
./fix-nodes.sh
```

**Windows (Command Prompt):**
```cmd
fix-nodes.bat
```

**Windows (PowerShell - Recommended):**
```powershell
.\fix-nodes.ps1
```

### Option B: Manual SQL

```bash
# Add test nodes
docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb < add-test-nodes.sql

# Restart API to sync nodes
docker-compose restart control-api

# Wait 30 seconds...
```

---

## Step 3: Verify Fix

Check if nodes were added:

```bash
# Check database
docker-compose exec postgres psql -U proxyhubb -d proxyhubb -c "SELECT * FROM explorer_nodes;"

# Check API
curl http://localhost:8081/v1/explorer/nodes?page=1&page_size=10
```

Then refresh your browser: http://localhost:3000/explorer/map

---

## What The Fix Does

The scripts will:
1. Create 12 test nodes with locations:
   - 2 nodes in **Ghana** (Accra, Kumasi)
   - 2 nodes in **United States** (Virginia, California)
   - 1 node in **Germany** (Frankfurt)
   - 1 node in **United Kingdom** (London)
   - 1 node in **Singapore**
   - 1 node in **Japan** (Tokyo)
   - 1 node in **Brazil** (Sao Paulo)
   - 1 node in **India** (Mumbai)
   - 1 node in **South Africa** (Johannesburg)
   - 1 node in **France** (Paris)

2. Mark them as healthy
3. Trigger NodeSync to copy to explorer_nodes
4. Wait for sync to complete

---

## Expected Result

After running the fix, you should see:
- ✅ Total Nodes: 12
- ✅ Active: 12
- ✅ Map markers in multiple countries
- ✅ Region distribution showing countries
- ✅ Clickable markers with node details

---

## If Still Not Working

### Check 1: API Connection
```bash
curl http://localhost:8081/v1/explorer/nodes?page=1&page_size=10
```
Should return JSON with nodes array.

### Check 2: Browser Console
1. Open browser dev tools (F12)
2. Go to Console tab
3. Look for red errors
4. Go to Network tab
5. Look for failed requests

### Check 3: Full Reset
```bash
# Nuclear option - removes everything
docker-compose down -v
docker-compose up -d

# Then add test nodes again
./fix-nodes.sh
```

---

## Quick Commands Reference

```bash
# Check containers
docker-compose ps

# View API logs
docker-compose logs -f control-api

# Check database
docker-compose exec postgres psql -U proxyhubb -d proxyhubb -c "SELECT * FROM explorer_nodes;"

# Restart services
docker-compose restart control-api web

# Full rebuild
docker-compose down
docker-compose up -d --build
```

---

## File Reference

| File | Use When... |
|------|-------------|
| `diagnose-node-map.sh` / `.bat` / `.ps1` | You want to check what's wrong |
| `fix-nodes.sh` / `.bat` / `.ps1` | You want to add test nodes automatically |
| `add-test-nodes.sql` | You want to manually add nodes |
| `DEBUG_NODE_MAP.md` | You need detailed troubleshooting |

---

## Still Need Help?

If none of this works:

1. Run diagnostics: `./diagnose-node-map.sh`
2. Copy the full output
3. Check browser console for errors (F12)
4. Share both for further analysis

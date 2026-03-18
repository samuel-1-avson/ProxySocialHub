# PowerShell Scripts for Node Map Fix

## Overview

PowerShell scripts (`.ps1`) provide better error handling and colored output compared to batch files (`.bat`). These scripts are recommended for Windows users.

---

## Scripts Available

| Script | Purpose | Equivalent |
|--------|---------|------------|
| `update-node-map.ps1` | Rebuild web container with fixes | `update-node-map.bat` |
| `diagnose-node-map.ps1` | Check system status and issues | `diagnose-node-map.bat` |
| `fix-nodes.ps1` | Add test nodes to database | `fix-nodes.bat` |

---

## How to Run PowerShell Scripts

### Option 1: PowerShell Console (Recommended)

1. Open PowerShell as Administrator
2. Navigate to project folder:
   ```powershell
   cd C:\path\to\proxyhubb
   ```
3. Run the script:
   ```powershell
   .\diagnose-node-map.ps1
   ```

### Option 2: Right-Click Run

1. Right-click on the `.ps1` file
2. Select "Run with PowerShell"

### Option 3: From File Explorer

1. Open File Explorer
2. Navigate to the project folder
3. Hold Shift + Right-click in empty space
4. Select "Open PowerShell window here"
5. Run: `.\script-name.ps1`

---

## Execution Policy (If Scripts Won't Run)

If you get an error about execution policy, run this in PowerShell as Administrator:

```powershell
# Check current policy
Get-ExecutionPolicy

# Allow local scripts to run (recommended)
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# Or bypass for this session only
powershell -ExecutionPolicy Bypass -File .\diagnose-node-map.ps1
```

---

## Quick Start

### 1. Diagnose Issues

```powershell
.\diagnose-node-map.ps1
```

This will show you exactly what's wrong with color-coded output.

### 2. Fix Missing Nodes

```powershell
.\fix-nodes.ps1
```

This creates 12 test nodes with locations worldwide (including Ghana).

### 3. Update Web Container

```powershell
.\update-node-map.ps1
```

This rebuilds the web container with all the Node Map fixes.

---

## Color Coding

PowerShell scripts use colors to make output easier to read:

- ✅ **Green** - Success/OK
- ⚠️ **Yellow** - Warning/Needs attention
- ❌ **Red** - Error/Failed
- ▶ **Blue** - Section headers

---

## Troubleshooting PowerShell Issues

### "Script cannot be loaded"

**Solution:** Change execution policy
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force
```

### "The term 'docker-compose' is not recognized"

**Solution:** Ensure Docker Desktop is installed and running
```powershell
# Test docker
docker --version
docker-compose --version
```

### Colors not showing (showing as `[32m` instead of green)

**Solution:** Your PowerShell version might be old. Update to PowerShell 5.1 or later:
```powershell
$PSVersionTable.PSVersion
```

For older versions, use the `.bat` files instead.

---

## Why PowerShell Instead of Batch?

| Feature | Batch (.bat) | PowerShell (.ps1) |
|---------|-------------|-------------------|
| Error handling | Limited | Excellent |
| Colors | No | Yes |
| JSON parsing | No | Yes |
| Progress indicators | Basic | Better |
| Try-catch | No | Yes |
| Output formatting | Basic | Excellent |

---

## All Commands Reference

### Full Fix Process (PowerShell)

```powershell
# Step 1: Navigate to project
cd C:\path\to\proxyhubb

# Step 2: Diagnose
.\diagnose-node-map.ps1

# Step 3: Fix nodes (if needed)
.\fix-nodes.ps1

# Step 4: Open browser
Start-Process "http://localhost:3000/explorer/map"
```

---

## Still Having Issues?

If PowerShell scripts don't work:

1. **Use batch files instead:**
   ```cmd
   diagnose-node-map.bat
   ```

2. **Or run manually:**
   ```powershell
   # Add test nodes manually
   docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb -c "
     INSERT INTO nodes (id, ip_address, port, connection_type, is_healthy, region, country, hotkey, created_at, updated_at, last_seen_at)
     VALUES (gen_random_uuid(), '192.168.1.100', 8080, 'http', true, 'af-west-1', 'Ghana', 'ghana-test', NOW(), NOW(), NOW());
   "
   
   # Restart API
   docker-compose restart control-api
   ```

3. **Check the detailed guides:**
   - `QUICK_FIX_GUIDE.md`
   - `DEBUG_NODE_MAP.md`

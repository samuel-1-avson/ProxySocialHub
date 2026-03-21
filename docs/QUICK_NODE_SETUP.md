# Quick Node Setup Guide (Real-Time Sync)

## Overview

Create a node and see it appear **instantly** on the Proxy Explorer map!

## Prerequisites

1. **Docker is running** with updated control-api (real-time sync enabled)
2. **API Key** from the web dashboard
3. **CLI binary** (`provider-cli` or `proxy-hub`)

---

## Step 1: Get the CLI

### Option A: Use Pre-built Binary

```powershell
# Windows
cd f:\project\proxyhubb\cli-dist\1.0.0
copy provider-cli-1.0.0-windows-amd64.exe C:\Windows\System32\proxy-hub.exe

# Or run directly
.\provider-cli-1.0.0-windows-amd64.exe node register
```

### Option B: Build from Source

```powershell
cd f:\project\proxyhubb\services\control-api\cmd\provider-cli
go build -o proxy-hub.exe .
# Move to PATH
mv proxy-hub.exe C:\Windows\System32\
```

---

## Step 2: Get API Key from Dashboard

1. Open: http://localhost:3000/dashboard/provider
2. Login with your account
3. Go to **Settings → API Keys**
4. Click **"Generate New Key"**
5. Copy the key (starts with `phb_`)

---

## Step 3: Configure CLI

```powershell
# Set API URL
proxy-hub config set api_url "http://localhost:8081"

# Set your API key
proxy-hub config set api_key "phb_your_api_key_here"

# Verify
proxy-hub config get
```

---

## Step 4: Register Your Node

### Interactive Mode (Recommended)

```powershell
proxy-hub node register
```

You'll be prompted:
```
--- ProxyHub Node Registration ---
Enter Public IP Address: 203.0.113.1
Enter Port: 8080
Enter Node Type (residential/mobile/datacenter): residential
Enter Solana Wallet Address (for payouts): 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU

SUCCESS: Node registered in ProxyHub Registry.
```

### Automated (Script)

```powershell
$ip = (Invoke-WebRequest -Uri "https://api.ipify.org").Content.Trim()
$wallet = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"

proxy-hub node register --ip $ip --port 8080 --type residential --wallet $wallet
```

---

## Step 5: Verify Real-Time Sync! ⚡

### Terminal: Watch Logs

```powershell
cd f:\project\proxyhubb
docker-compose logs -f control-api --tail=20
```

You should see:
```
Gateway node registered
Node synced to explorer immediately    <-- THIS IS THE NEW FEATURE!
```

### Browser: Check Explorer

1. Open: http://localhost:3000/explorer/map
2. **Within 1 second**, your node appears on the globe! 🎉

### API: Verify Data

```powershell
# Check node count
(Invoke-WebRequest http://localhost:8081/v1/explorer/nodes | ConvertFrom-Json).total

# Check geo data
(Invoke-WebRequest http://localhost:8081/v1/explorer/nodes/geo | ConvertFrom-Json).nodes | Format-Table node_id, region, is_active
```

---

## Step 6: Start Serving Traffic (Optional)

To actually serve proxy traffic:

```powershell
# Get JWT token first
proxy-hub auth login

# Start node
proxy-hub node start --gateway-addr localhost:4000
```

---

## Full Test Script (PowerShell)

```powershell
# Test-NodeCreation.ps1

Write-Host "=== Testing Real-Time Node Sync ===" -ForegroundColor Cyan

# 1. Check API
Write-Host "Checking API..." -NoNewline
try {
    $health = Invoke-WebRequest -Uri "http://localhost:8081/health" -ErrorAction Stop
    Write-Host " ✓" -ForegroundColor Green
} catch {
    Write-Host " ✗ API not running!" -ForegroundColor Red
    exit 1
}

# 2. Get count before
$before = (Invoke-WebRequest http://localhost:8081/v1/explorer/nodes | ConvertFrom-Json).total
Write-Host "Explorer nodes before: $before"

# 3. Register node
Write-Host "Registering node..." -NoNewline
$ip = (Invoke-WebRequest -Uri "https://api.ipify.org" -TimeoutSec 10).Content.Trim()
$body = @{
    ip_address = $ip
    port = 9999
    connection_type = "residential"
    wallet_address = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
} | ConvertTo-Json

$apiKey = (proxy-hub config get api_key 2>$null) || "your-api-key"

$response = Invoke-WebRequest -Uri "http://localhost:8081/v1/provider/nodes" `
    -Method POST `
    -Headers @{
        "Authorization" = "Bearer $apiKey"
        "Content-Type" = "application/json"
    } `
    -Body $body

if ($response.StatusCode -eq 201) {
    Write-Host " ✓ Created" -ForegroundColor Green
} else {
    Write-Host " ✗ Failed" -ForegroundColor Red
    exit 1
}

# 4. Wait and check
Write-Host "Waiting for real-time sync..." -NoNewline
Start-Sleep -Seconds 2
$after = (Invoke-WebRequest http://localhost:8081/v1/explorer/nodes | ConvertFrom-Json).total
Write-Host " Done"

# 5. Verify
if ($after -gt $before) {
    Write-Host "✓ SUCCESS! Node appeared in explorer immediately!" -ForegroundColor Green
    Write-Host "  Before: $before nodes"
    Write-Host "  After:  $after nodes"
} else {
    Write-Host "✗ FAIL: Node did not appear (check control-api logs)" -ForegroundColor Red
}
```

---

## Troubleshooting

### "command not found: proxy-hub"

```powershell
# Add to PATH
$env:Path += ";f:\project\proxyhubb\cli-dist\1.0.0"

# Or use full path
f:\project\proxyhubb\cli-dist\1.0.0\provider-cli-1.0.0-windows-amd64.exe node register
```

### "API Key is required"

Get your API key from: http://localhost:3000/dashboard/provider/settings

### "Connection refused"

```powershell
# Check if containers are running
docker-compose ps

# Start if needed
docker-compose up -d
```

### "Node not appearing in explorer"

```powershell
# Check control-api logs
docker-compose logs control-api | Select-String "sync"

# Verify in database
docker-compose exec postgres psql -U proxyhubb -d proxyhubb -c "SELECT id, is_healthy FROM nodes ORDER BY created_at DESC LIMIT 3;"
docker-compose exec postgres psql -U proxyhubb -d proxyhubb -c "SELECT node_id, is_active, region FROM explorer_nodes ORDER BY updated_at DESC LIMIT 3;"
```

---

## Summary

| Step | Command | Time |
|------|---------|------|
| 1 | `proxy-hub config set api_key xxx` | 5s |
| 2 | `proxy-hub node register` | 10s |
| 3 | Open http://localhost:3000/explorer/map | **1s** ⚡ |

**Before this update**: Node appeared after 0-5 minutes

**After this update**: Node appears in **~1 second**!

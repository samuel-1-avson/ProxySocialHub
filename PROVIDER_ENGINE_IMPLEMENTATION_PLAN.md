# ProxyHub Provider Engine — Implementation Plan

**Date**: 2026-03-16
**Based On**: `PROVIDER_ENGINE_DEEP_DIVE_ANALYSIS.md`
**Goal**: Fix all critical bugs, remove all barriers to entry (any computer = valid node), and implement all missing provider features.

---

## Core Design Principle: Open Node Registration

> **Every computer should be able to become a provider node with zero friction.**
> No KYC. No email verification. No IP ownership checks. No approval gates.
> Register → Connect → Earn. That's it.

---

## Table of Contents

- [Phase 1 — Remove Barriers & Fix Critical Auth](#phase-1--remove-barriers--fix-critical-auth)
- [Phase 2 — Fix Data Integrity Bugs](#phase-2--fix-data-integrity-bugs)
- [Phase 3 — Heartbeat & Node Health System](#phase-3--heartbeat--node-health-system)
- [Phase 4 — Provider Earnings & Payout Pipeline](#phase-4--provider-earnings--payout-pipeline)
- [Phase 5 — Provider Dashboard (Frontend)](#phase-5--provider-dashboard-frontend)
- [Phase 6 — Tier System Fixes](#phase-6--tier-system-fixes)
- [Phase 7 — Dispute & Review System](#phase-7--dispute--review-system)
- [Phase 8 — Platform Commission](#phase-8--platform-commission)
- [Phase 9 — Geographic Routing](#phase-9--geographic-routing)
- [Phase 10 — CLI Auto-Update & Improvements](#phase-10--cli-auto-update--improvements)
- [Implementation Checklist](#implementation-checklist)

---

## Phase 1 — Remove Barriers & Fix Critical Auth

### 1.1 Remove KYC, Email Verification & IP Checks

**Files to modify**:
- `services/control-api/internal/api/` — any remaining handler that references KYC or verification gates
- `services/control-api/main.go` — remove any KYC route registrations
- `apps/web/src/components/ProviderSetupGuide.tsx` — remove verification step from UI

**What to remove / change**:

| Item | Action |
|------|--------|
| KYC step in registration | Remove — already deleted (`kyc.go` gone), ensure no references remain |
| Email confirmation before node activation | Remove — node is active immediately on registration |
| IP ownership verification challenge | Remove — any IP is accepted |
| Duplicate IP detection/rejection | Remove — same IP can be registered by multiple providers |
| Admin approval gates | Remove — nodes go live instantly |
| Supabase email confirmation check in middleware | Remove or bypass |

**Node Registration — New Minimal Flow**:
```
POST /v1/provider/nodes
  Body: { name, connection_type, country (optional), city (optional) }
  Auth: Bearer <provider_token>

  → Validate provider token (or JWT)
  → Insert node row with status = "active"
  → Return: { node_id, gateway_address, token }

  DONE. Node is live immediately.
```

**Code change in node registration handler** — ensure it does NOT:
- Check email_verified on user
- Check kyc_status
- Call any IP verification function
- Require any admin approval flag

```go
// ❌ REMOVE any code like this:
if !user.EmailVerified {
    c.JSON(403, gin.H{"error": "Email verification required"})
    return
}
if user.KYCStatus != "approved" {
    c.JSON(403, gin.H{"error": "KYC required"})
    return
}

// ✅ REPLACE with: just validate the auth token and insert the node
```

---

### 1.2 Fix JWT Validation in Provider Token Auth Middleware

**File**: `services/control-api/internal/middleware/provider_token_auth.go`

**Problem**: `validateJWT()` is a stub that always returns `ErrInvalidToken`. Supabase JWTs are never validated — all authenticated users must use provider tokens.

**Fix**: Implement real Supabase JWT validation using the Supabase JWT secret.

```go
// services/control-api/internal/middleware/provider_token_auth.go

import (
    "crypto/sha256"
    "encoding/hex"
    "errors"
    "net/http"
    "os"
    "strings"
    "time"

    "github.com/gin-gonic/gin"
    "github.com/golang-jwt/jwt/v5"
    "github.com/google/uuid"
    "github.com/proxyhubb/control-api/internal/db"
    "github.com/proxyhubb/control-api/internal/models"
)

// validateJWT validates a Supabase-issued JWT token.
// Returns the user's UUID string on success.
func validateJWT(tokenStr string) (string, error) {
    secret := os.Getenv("SUPABASE_JWT_SECRET")
    if secret == "" {
        return "", errors.New("SUPABASE_JWT_SECRET not configured")
    }

    token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
        if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
            return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
        }
        return []byte(secret), nil
    })
    if err != nil || !token.Valid {
        return "", errors.New("invalid JWT")
    }

    claims, ok := token.Claims.(jwt.MapClaims)
    if !ok {
        return "", errors.New("invalid JWT claims")
    }

    sub, ok := claims["sub"].(string)
    if !ok || sub == "" {
        return "", errors.New("missing sub claim")
    }

    return sub, nil
}
```

**Add to go.mod** (if not present):
```
github.com/golang-jwt/jwt/v5 v5.2.1
```

**Add to `.env.example`**:
```env
SUPABASE_JWT_SECRET=your-supabase-jwt-secret-here
```

---

### 1.3 Replace Predictable Nonces with crypto/rand

**Files**: Any file using `time.Now().UnixNano()` for nonces in escrow/crypto operations.

**Search and replace pattern**:
```go
// ❌ REMOVE:
nonce := time.Now().UnixNano()

// ✅ REPLACE WITH:
nonceBytes := make([]byte, 8)
if _, err := rand.Read(nonceBytes); err != nil {
    // handle error
}
nonce := binary.BigEndian.Uint64(nonceBytes)
```

---

## Phase 2 — Fix Data Integrity Bugs

### 2.1 Fix: `TotalSessionsServed` Never Incremented

**File**: `services/control-api/internal/api/session.go` — in the session termination / completion handler.

**Find the `terminateSession` or session-completion logic and add**:

```go
// After marking session as expired/terminated:
// Increment total_sessions_served on the provider node
if session.ProviderNodeID != nil {
    db.DB.Model(&models.ProviderNode{}).
        Where("id = ?", session.ProviderNodeID).
        UpdateColumn("total_sessions_served", gorm.Expr("total_sessions_served + 1"))
}
```

Also increment when session expires due to bandwidth exhaustion (wherever `status = expired` is set):

```go
db.DB.Model(&models.ProviderNode{}).
    Where("id = ?", nodeID).
    UpdateColumn("total_sessions_served", gorm.Expr("total_sessions_served + 1"))
```

---

### 2.2 Fix: Soft-Deleted Nodes Receiving Sessions

**File**: All queries in `session.go`, `listings.go`, and any handler that selects provider nodes.

**Audit every `db.DB.Where(...)` that selects nodes and ensure `deleted_at IS NULL` is present**:

```go
// ❌ VULNERABLE — can return deleted nodes:
db.DB.Where("is_healthy = ? AND country_code = ?", true, geo).First(&node)

// ✅ FIXED — GORM soft-delete filter (automatic when using gorm.DeletedAt model field):
// Actually, GORM adds WHERE deleted_at IS NULL automatically if the model uses gorm.DeletedAt
// BUT raw queries must be checked manually:
db.DB.Where("is_healthy = ? AND country_code = ? AND deleted_at IS NULL", true, geo).First(&node)
```

**Action**: Run a grep across all API handler files:
```bash
grep -n "db.DB.Where" services/control-api/internal/api/*.go | grep -v "deleted_at"
```
For every result that queries `nodes` or `provider_nodes` tables, verify GORM soft-delete is applied.

---

### 2.3 Fix: Double-Payout Idempotency

**File**: `services/control-api/internal/billing/batch_payout.go`

**Add idempotency key to `PendingPayout` model and check before inserting**:

```go
// In QueuePayout():
func (bp *BatchPayoutProcessor) QueuePayout(providerID uuid.UUID, walletAddress string, amountSOL float64, sessionIDs []string) error {
    // Generate idempotency key from session IDs
    sort.Strings(sessionIDs)
    hash := sha256.Sum256([]byte(strings.Join(sessionIDs, ",")))
    idempotencyKey := hex.EncodeToString(hash[:])

    // Check if already queued or processed
    var existing models.PendingPayout
    err := db.DB.Where("idempotency_key = ?", idempotencyKey).First(&existing).Error
    if err == nil {
        logging.Info().Str("key", idempotencyKey).Msg("Payout already queued, skipping duplicate")
        return nil
    }

    pending := models.PendingPayout{
        ProviderID:      providerID,
        WalletAddress:   walletAddress,
        AmountSOL:       amountSOL,
        IdempotencyKey:  idempotencyKey,
        Priority:        bp.calculatePriority(amountSOL),
        QueuedAt:        time.Now(),
    }
    return db.DB.Create(&pending).Error
}
```

**Add to model** (`models/batch_payout.go`):
```go
type PendingPayout struct {
    // ... existing fields ...
    IdempotencyKey string `gorm:"type:varchar(64);uniqueIndex" json:"idempotency_key"`
}
```

---

### 2.4 Fix: Redis Session TTL Sync with DB

**File**: `services/control-api/internal/api/session.go` — wherever session is written to Redis.

```go
// When writing session to Redis, calculate TTL from DB expires_at:
var redisTTL time.Duration
if session.ExpiresAt != nil && session.ExpiresAt.After(time.Now()) {
    redisTTL = time.Until(*session.ExpiresAt)
} else {
    redisTTL = 24 * time.Hour // default 24h if no expiry set
}

// Set Redis key with matching TTL
redisClient.Client.Set(ctx, "session:"+session.ID.String(), sessionData, redisTTL)
```

---

### 2.5 Fix: Bandwidth Available — Real-Time Decrement

**File**: `services/control-api/internal/api/session.go` — in `createSessionFromListing`.

```go
// After session is successfully created, atomically decrement listing bandwidth:
db.DB.Model(&models.ProxyListing{}).
    Where("id = ? AND available_bandwidth_gb >= ?", listingID, requestedBandwidthGB).
    UpdateColumn("available_bandwidth_gb", gorm.Expr("available_bandwidth_gb - ?", requestedBandwidthGB))
```

When session terminates, refund unused bandwidth back to listing:
```go
unusedGB := (session.BandwidthLimitBytes - session.BandwidthUsedBytes) / (1024 * 1024 * 1024)
if unusedGB > 0 {
    db.DB.Model(&models.ProxyListing{}).
        Where("id = ?", session.ListingID).
        UpdateColumn("available_bandwidth_gb", gorm.Expr("available_bandwidth_gb + ?", unusedGB))
}
```

---

## Phase 3 — Heartbeat & Node Health System

### 3.1 Heartbeat API Endpoint

**File**: `services/control-api/internal/api/` — add to whichever file handles node routes (create `nodes.go` if needed).

```go
// POST /v1/provider/nodes/:id/heartbeat
func nodeHeartbeat(c *gin.Context) {
    userID, ok := GetUserID(c)
    if !ok {
        c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
        return
    }

    nodeIDStr := c.Param("id")
    nodeID, err := uuid.Parse(nodeIDStr)
    if err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": "invalid node id"})
        return
    }

    // Optional metrics payload from CLI
    var req struct {
        LatencyMs         int     `json:"latency_ms"`
        ActiveConnections int     `json:"active_connections"`
        UptimePercent     float64 `json:"uptime_percent"`
        BandwidthUsedMB   int64   `json:"bandwidth_used_mb"`
    }
    c.ShouldBindJSON(&req)

    updates := map[string]interface{}{
        "last_seen_at":       time.Now(),
        "is_healthy":         true,
    }
    if req.LatencyMs > 0 {
        updates["latency_ms"] = req.LatencyMs
    }
    if req.ActiveConnections >= 0 {
        updates["active_connections"] = req.ActiveConnections
    }
    if req.UptimePercent > 0 {
        updates["uptime_percent"] = req.UptimePercent
    }

    result := db.DB.Model(&models.Node{}).
        Where("id = ? AND provider_user_id = ? AND deleted_at IS NULL", nodeID, userID).
        Updates(updates)

    if result.RowsAffected == 0 {
        c.JSON(http.StatusNotFound, gin.H{"error": "node not found"})
        return
    }

    c.JSON(http.StatusOK, gin.H{"status": "ok", "server_time": time.Now().Unix()})
}
```

**Register route** in `main.go` or wherever provider routes are grouped:
```go
providerRoutes.POST("/provider/nodes/:id/heartbeat", api.nodeHeartbeat)
```

---

### 3.2 Heartbeat Timeout Worker

**File**: Create `services/control-api/internal/worker/heartbeat_monitor.go`

```go
package worker

import (
    "log"
    "time"

    "github.com/proxyhubb/control-api/internal/db"
    "github.com/proxyhubb/control-api/internal/models"
)

const heartbeatTimeout = 5 * time.Minute

// StartHeartbeatMonitor runs every minute and marks nodes offline
// if they haven't sent a heartbeat within the timeout window.
func StartHeartbeatMonitor() {
    go func() {
        log.Println("Heartbeat Monitor started")
        ticker := time.NewTicker(1 * time.Minute)
        defer ticker.Stop()
        for range ticker.C {
            runHeartbeatCheck()
        }
    }()
}

func runHeartbeatCheck() {
    if db.DB == nil {
        return
    }

    cutoff := time.Now().Add(-heartbeatTimeout)

    // Mark nodes offline that haven't been seen recently
    result := db.DB.Model(&models.Node{}).
        Where("is_healthy = ? AND last_seen_at < ? AND deleted_at IS NULL", true, cutoff).
        Update("is_healthy", false)

    if result.RowsAffected > 0 {
        log.Printf("Heartbeat Monitor: marked %d nodes offline (no heartbeat > %v)",
            result.RowsAffected, heartbeatTimeout)
    }
}
```

**Start in `main.go`**:
```go
worker.StartHeartbeatMonitor()
log.Println("Heartbeat monitor started")
```

---

### 3.3 CLI — Heartbeat Loop

**File**: `services/control-api/cmd/provider-cli/cmd/node.go` — in the `start` command.

```go
// In the node start command, after connecting to gateway, start heartbeat goroutine:
go func() {
    ticker := time.NewTicker(2 * time.Minute)
    defer ticker.Stop()
    for range ticker.C {
        payload := map[string]interface{}{
            "latency_ms":         measureLocalLatency(),
            "active_connections": getActiveConnectionCount(),
            "uptime_percent":     calculateUptime(),
        }
        if err := apiClient.Post("/v1/provider/nodes/"+nodeID+"/heartbeat", payload); err != nil {
            log.Printf("Heartbeat failed: %v", err)
        }
    }
}()
```

---

## Phase 4 — Provider Earnings & Payout Pipeline

### 4.1 Provider Earnings Model

**File**: Create `services/control-api/internal/models/provider_earnings.go`

```go
package models

import (
    "time"
    "github.com/google/uuid"
)

// ProviderEarning records a single earning event for a provider
type ProviderEarning struct {
    ID            uuid.UUID  `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
    ProviderUserID uuid.UUID `gorm:"type:uuid;index" json:"provider_user_id"`
    NodeID        uuid.UUID  `gorm:"type:uuid;index" json:"node_id"`
    SessionID     uuid.UUID  `gorm:"type:uuid;index" json:"session_id"`
    BandwidthGB   float64    `json:"bandwidth_gb"`
    GrossAmountSOL float64   `json:"gross_amount_sol"`   // Before platform fee
    PlatformFeeSOL float64   `json:"platform_fee_sol"`   // Platform commission
    NetAmountSOL   float64   `json:"net_amount_sol"`     // Provider receives this
    EarningsMultiplier float64 `json:"earnings_multiplier"` // Quality multiplier applied
    Status        string     `json:"status"`              // pending | paid | failed
    PayoutBatchID *uuid.UUID `gorm:"type:uuid" json:"payout_batch_id,omitempty"`
    TxHash        string     `json:"tx_hash,omitempty"`
    CreatedAt     time.Time  `json:"created_at"`
    PaidAt        *time.Time `json:"paid_at,omitempty"`
}
```

**Migration** (`migrations/000030_provider_earnings.up.sql`):
```sql
CREATE TABLE IF NOT EXISTS provider_earnings (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_user_id UUID NOT NULL,
    node_id         UUID NOT NULL,
    session_id      UUID NOT NULL,
    bandwidth_gb    NUMERIC(20, 8) NOT NULL DEFAULT 0,
    gross_amount_sol NUMERIC(20, 8) NOT NULL DEFAULT 0,
    platform_fee_sol NUMERIC(20, 8) NOT NULL DEFAULT 0,
    net_amount_sol  NUMERIC(20, 8) NOT NULL DEFAULT 0,
    earnings_multiplier NUMERIC(5, 4) NOT NULL DEFAULT 1.0,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending',
    payout_batch_id UUID,
    tx_hash         VARCHAR(128),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    paid_at         TIMESTAMPTZ
);

CREATE INDEX idx_provider_earnings_user   ON provider_earnings(provider_user_id);
CREATE INDEX idx_provider_earnings_node   ON provider_earnings(node_id);
CREATE INDEX idx_provider_earnings_status ON provider_earnings(status);
```

---

### 4.2 Earnings Recording on Session End

**File**: `services/control-api/internal/api/session.go` — in `terminateSession` and bandwidth-exhaustion handler.

```go
func recordProviderEarning(session models.Session, bandwidthUsedBytes int64) {
    if session.ProviderNodeID == nil {
        return
    }

    var node models.Node
    if err := db.DB.First(&node, "id = ?", session.ProviderNodeID).Error; err != nil {
        return
    }

    var listing models.ProxyListing
    if err := db.DB.First(&listing, "id = ?", session.ListingID).Error; err != nil {
        return
    }

    bandwidthGB := float64(bandwidthUsedBytes) / (1024 * 1024 * 1024)
    grossSOL := bandwidthGB * listing.PricePerGB
    multiplier := node.GetEarningsMultiplier()

    const platformFeePercent = 0.10 // 10% platform commission
    platformFeeSOL := grossSOL * platformFeePercent
    netSOL := (grossSOL - platformFeeSOL) * multiplier

    earning := models.ProviderEarning{
        ProviderUserID:      node.ProviderUserID,
        NodeID:              node.ID,
        SessionID:           session.ID,
        BandwidthGB:         bandwidthGB,
        GrossAmountSOL:      grossSOL,
        PlatformFeeSOL:      platformFeeSOL,
        NetAmountSOL:        netSOL,
        EarningsMultiplier:  multiplier,
        Status:              "pending",
    }
    db.DB.Create(&earning)

    // Queue for batch payout
    batchProcessor.QueuePayout(
        node.ProviderUserID,
        node.WalletAddress, // ensure this field exists on Node model
        netSOL,
        []string{session.ID.String()},
    )
}
```

---

### 4.3 Provider Earnings API

**File**: `services/control-api/internal/api/provider_earnings.go` (new file)

```go
package api

import (
    "net/http"
    "time"

    "github.com/gin-gonic/gin"
    "github.com/proxyhubb/control-api/internal/db"
    "github.com/proxyhubb/control-api/internal/models"
)

func RegisterProviderEarningsRoutes(rg *gin.RouterGroup) {
    rg.GET("/provider/earnings", getProviderEarnings)
    rg.GET("/provider/earnings/summary", getProviderEarningsSummary)
    rg.GET("/provider/earnings/history", getProviderPayoutHistory)
}

// GET /v1/provider/earnings/summary
func getProviderEarningsSummary(c *gin.Context) {
    userID, ok := GetUserID(c)
    if !ok {
        c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
        return
    }

    var summary struct {
        TotalEarnedSOL   float64 `json:"total_earned_sol"`
        PendingSOL       float64 `json:"pending_sol"`
        PaidSOL          float64 `json:"paid_sol"`
        TotalSessions    int64   `json:"total_sessions"`
        TotalBandwidthGB float64 `json:"total_bandwidth_gb"`
        Last30DaysSOL    float64 `json:"last_30_days_sol"`
        Last7DaysSOL     float64 `json:"last_7_days_sol"`
    }

    db.DB.Model(&models.ProviderEarning{}).
        Where("provider_user_id = ?", userID).
        Select(`
            SUM(net_amount_sol) as total_earned_sol,
            SUM(CASE WHEN status = 'pending' THEN net_amount_sol ELSE 0 END) as pending_sol,
            SUM(CASE WHEN status = 'paid'    THEN net_amount_sol ELSE 0 END) as paid_sol,
            COUNT(*) as total_sessions,
            SUM(bandwidth_gb) as total_bandwidth_gb
        `).Scan(&summary)

    // Last 30 days
    db.DB.Model(&models.ProviderEarning{}).
        Where("provider_user_id = ? AND created_at > ?", userID, time.Now().AddDate(0, 0, -30)).
        Select("SUM(net_amount_sol)").Scan(&summary.Last30DaysSOL)

    // Last 7 days
    db.DB.Model(&models.ProviderEarning{}).
        Where("provider_user_id = ? AND created_at > ?", userID, time.Now().AddDate(0, 0, -7)).
        Select("SUM(net_amount_sol)").Scan(&summary.Last7DaysSOL)

    c.JSON(http.StatusOK, summary)
}

// GET /v1/provider/earnings?page=1&limit=20
func getProviderEarnings(c *gin.Context) {
    userID, ok := GetUserID(c)
    if !ok {
        c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
        return
    }

    page := 1
    limit := 20
    // parse page/limit from query ...

    var earnings []models.ProviderEarning
    var total int64

    db.DB.Model(&models.ProviderEarning{}).
        Where("provider_user_id = ?", userID).
        Count(&total)

    db.DB.Where("provider_user_id = ?", userID).
        Order("created_at DESC").
        Offset((page - 1) * limit).
        Limit(limit).
        Find(&earnings)

    c.JSON(http.StatusOK, gin.H{
        "earnings": earnings,
        "total":    total,
        "page":     page,
        "limit":    limit,
    })
}

// GET /v1/provider/earnings/history — paid payouts with tx_hash
func getProviderPayoutHistory(c *gin.Context) {
    userID, ok := GetUserID(c)
    if !ok {
        c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
        return
    }

    var payouts []models.ProviderEarning
    db.DB.Where("provider_user_id = ? AND status = 'paid'", userID).
        Order("paid_at DESC").
        Limit(100).
        Find(&payouts)

    c.JSON(http.StatusOK, gin.H{"payouts": payouts})
}
```

---

### 4.4 Wallet Address on Node Model

**File**: `services/control-api/internal/models/node.go`

Add `wallet_address` field to `Node` struct (providers must supply their Solana wallet to receive payments):

```go
// In Node struct, add:
WalletAddress string `gorm:"type:varchar(64)" json:"wallet_address,omitempty"` // Solana wallet for earnings
```

**Migration** (`migrations/000031_node_wallet.up.sql`):
```sql
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS wallet_address VARCHAR(64);
```

---

## Phase 5 — Provider Dashboard (Frontend)

### 5.1 Provider Dashboard Overview Page

**File**: `apps/web/src/app/dashboard/provider/page.tsx`

Replace the current redirect with a real overview page:

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { getProviderEarningsSummary, getMyNodes } from '@/lib/api/provider';

export default function ProviderDashboard() {
  const { data: earnings } = useQuery({
    queryKey: ['provider-earnings-summary'],
    queryFn: getProviderEarningsSummary,
  });

  const { data: nodes } = useQuery({
    queryKey: ['my-nodes'],
    queryFn: getMyNodes,
  });

  const onlineNodes = nodes?.nodes.filter(n => n.status === 'online').length ?? 0;
  const totalNodes  = nodes?.nodes.length ?? 0;

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-bold">Provider Dashboard</h1>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Earned" value={`${earnings?.total_earned_sol?.toFixed(4) ?? '0'} SOL`} />
        <StatCard label="Pending Payout" value={`${earnings?.pending_sol?.toFixed(4) ?? '0'} SOL`} />
        <StatCard label="Last 7 Days" value={`${earnings?.last_7_days_sol?.toFixed(4) ?? '0'} SOL`} />
        <StatCard label="Nodes Online" value={`${onlineNodes} / ${totalNodes}`} />
      </div>

      {/* Nodes Table */}
      <NodeTable nodes={nodes?.nodes ?? []} />

      {/* Recent Earnings */}
      <RecentEarnings />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}
```

---

### 5.2 Provider Earnings Page

**File**: `apps/web/src/app/dashboard/earnings/page.tsx` (create if not exists)

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { getProviderEarnings, getProviderEarningsSummary } from '@/lib/api/provider';

export default function EarningsPage() {
  const { data: summary } = useQuery({
    queryKey: ['provider-earnings-summary'],
    queryFn: getProviderEarningsSummary,
  });

  const { data: earnings } = useQuery({
    queryKey: ['provider-earnings'],
    queryFn: () => getProviderEarnings({ page: 1, limit: 50 }),
  });

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-bold">Earnings</h1>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded border p-4">
          <p className="text-sm text-muted-foreground">Total Earned</p>
          <p className="text-3xl font-bold">{summary?.total_earned_sol?.toFixed(4)} SOL</p>
        </div>
        <div className="rounded border p-4">
          <p className="text-sm text-muted-foreground">Pending</p>
          <p className="text-3xl font-bold text-yellow-500">{summary?.pending_sol?.toFixed(4)} SOL</p>
        </div>
        <div className="rounded border p-4">
          <p className="text-sm text-muted-foreground">Total Bandwidth Served</p>
          <p className="text-3xl font-bold">{summary?.total_bandwidth_gb?.toFixed(2)} GB</p>
        </div>
      </div>

      {/* Earnings Table */}
      <div className="rounded border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="p-3 text-left">Date</th>
              <th className="p-3 text-left">Session</th>
              <th className="p-3 text-right">Bandwidth</th>
              <th className="p-3 text-right">Gross</th>
              <th className="p-3 text-right">Fee (10%)</th>
              <th className="p-3 text-right">Net Earned</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-left">Tx Hash</th>
            </tr>
          </thead>
          <tbody>
            {earnings?.earnings?.map((e: any) => (
              <tr key={e.id} className="border-b hover:bg-muted/30">
                <td className="p-3">{new Date(e.created_at).toLocaleDateString()}</td>
                <td className="p-3 font-mono text-xs">{e.session_id.slice(0, 8)}...</td>
                <td className="p-3 text-right">{e.bandwidth_gb.toFixed(4)} GB</td>
                <td className="p-3 text-right">{e.gross_amount_sol.toFixed(6)} SOL</td>
                <td className="p-3 text-right text-red-400">{e.platform_fee_sol.toFixed(6)} SOL</td>
                <td className="p-3 text-right text-green-400 font-bold">{e.net_amount_sol.toFixed(6)} SOL</td>
                <td className="p-3">
                  <span className={`px-2 py-0.5 rounded text-xs ${
                    e.status === 'paid' ? 'bg-green-100 text-green-700' :
                    e.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-red-100 text-red-700'
                  }`}>{e.status}</span>
                </td>
                <td className="p-3 font-mono text-xs">
                  {e.tx_hash ? (
                    <a href={`https://solscan.io/tx/${e.tx_hash}`} target="_blank" rel="noopener noreferrer"
                      className="text-blue-500 hover:underline">
                      {e.tx_hash.slice(0, 12)}...
                    </a>
                  ) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

---

### 5.3 Node Health Dashboard

**File**: `apps/web/src/app/dashboard/provider/nodes/page.tsx` (create or update)

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { getMyNodes, getNodeUptime } from '@/lib/api/provider';

export default function NodesPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['my-nodes'],
    queryFn: getMyNodes,
    refetchInterval: 30_000, // auto-refresh every 30s
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">My Nodes</h1>
        <AddNodeButton />
      </div>

      {isLoading ? <p>Loading...</p> : (
        <div className="space-y-3">
          {data?.nodes?.map((node: any) => (
            <NodeCard key={node.id} node={node} />
          ))}
          {data?.nodes?.length === 0 && (
            <div className="rounded border p-8 text-center text-muted-foreground">
              <p>No nodes registered yet.</p>
              <p className="text-sm mt-2">Download the CLI and run <code>proxyhub-provider wizard</code> to get started.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NodeCard({ node }: { node: any }) {
  const isOnline = node.status === 'online';
  return (
    <div className="rounded border p-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className={`w-3 h-3 rounded-full ${isOnline ? 'bg-green-500' : 'bg-red-500'}`} />
        <div>
          <p className="font-medium">{node.name || node.id.slice(0, 8)}</p>
          <p className="text-xs text-muted-foreground">{node.country || 'Unknown location'} · {node.connection_type || 'unknown'}</p>
        </div>
      </div>
      <div className="flex gap-6 text-sm text-right">
        <div>
          <p className="text-muted-foreground text-xs">Uptime</p>
          <p className="font-medium">{node.uptime_percent?.toFixed(1) ?? '—'}%</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Latency</p>
          <p className="font-medium">{node.latency_ms ?? '—'} ms</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Connections</p>
          <p className="font-medium">{node.active_connections ?? 0}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Score</p>
          <p className="font-medium">{node.quality_score?.toFixed(0) ?? '—'}</p>
        </div>
      </div>
    </div>
  );
}
```

---

### 5.4 Frontend API — Add Earnings Functions

**File**: `apps/web/src/lib/api/provider.ts` — append:

```typescript
// ============ Earnings API ============

export interface EarningRecord {
  id: string;
  node_id: string;
  session_id: string;
  bandwidth_gb: number;
  gross_amount_sol: number;
  platform_fee_sol: number;
  net_amount_sol: number;
  earnings_multiplier: number;
  status: 'pending' | 'paid' | 'failed';
  tx_hash?: string;
  created_at: string;
  paid_at?: string;
}

export interface EarningsSummary {
  total_earned_sol: number;
  pending_sol: number;
  paid_sol: number;
  total_sessions: number;
  total_bandwidth_gb: number;
  last_30_days_sol: number;
  last_7_days_sol: number;
}

export async function getProviderEarningsSummary(): Promise<EarningsSummary> {
  return apiGet<EarningsSummary>('/v1/provider/earnings/summary');
}

export async function getProviderEarnings(params?: { page?: number; limit?: number }): Promise<{
  earnings: EarningRecord[];
  total: number;
  page: number;
  limit: number;
}> {
  return apiGet('/v1/provider/earnings', params as any);
}

export async function getProviderPayoutHistory(): Promise<{ payouts: EarningRecord[] }> {
  return apiGet('/v1/provider/earnings/history');
}
```

---

### 5.5 Update Sidebar Navigation

**File**: `apps/web/src/components/Sidebar.tsx` — ensure provider nav items are present:

```tsx
// In the provider section of sidebar navigation:
const providerNavItems = [
  { href: '/dashboard/provider', label: 'Overview', icon: LayoutDashboard },
  { href: '/dashboard/provider/nodes', label: 'My Nodes', icon: Server },
  { href: '/dashboard/provider/services', label: 'Services', icon: Globe },
  { href: '/dashboard/provider/analytics', label: 'Analytics', icon: BarChart2 },
  { href: '/dashboard/earnings', label: 'Earnings', icon: Wallet },
];
```

---

## Phase 6 — Tier System Fixes

### 6.1 Fix Session Count & Tier Promotion Notifications

**Files**: `session.go` (add increment — Phase 2.1 above) + new notification on tier change.

**In `tier_evaluator.go` — add tier change detection and notification**:

```go
for _, node := range nodes {
    score := computeTierScore(node)
    tier  := assignTier(node, score)
    previousTier := node.Tier

    updates := map[string]interface{}{
        "tier_score": score,
        "tier":       tier,
    }
    if tier != "unverified" && node.TierVerifiedAt == nil {
        updates["tier_verified_at"] = now
    }

    db.DB.Model(&models.ProviderNode{}).Where("id = ?", node.ID).Updates(updates)

    // Notify provider if tier changed
    if tier != previousTier {
        go notifyTierChange(node.UserID, previousTier, tier)
    }
}

func notifyTierChange(userID uuid.UUID, from, to string) {
    // TODO: send in-app notification + optional email
    log.Printf("Provider %s tier changed: %s → %s", userID, from, to)
    // Insert into notifications table
    db.DB.Create(&models.Notification{
        UserID:  userID,
        Type:    "tier_change",
        Title:   fmt.Sprintf("Provider Tier Updated: %s", strings.Title(to)),
        Message: fmt.Sprintf("Your provider tier changed from %s to %s.", from, to),
    })
}
```

### 6.2 Grace Period Before Demotion

**In `assignTier()`** — add a 2-evaluation grace period before demotion (don't demote on first bad eval):

```go
// Only demote if the node has been below threshold for 2+ consecutive evaluations
// Track via a "tier_demotion_warnings" field on ProviderNode
func assignTierWithGrace(node models.ProviderNode, score float64) string {
    newTier := assignTier(node, score)

    // If this is a demotion, increment warning counter
    currentTierRank := tierRank(node.Tier)
    newTierRank     := tierRank(newTier)

    if newTierRank < currentTierRank {
        if node.DemotionWarnings < 2 {
            // Give grace — increment counter but don't demote yet
            db.DB.Model(&models.ProviderNode{}).Where("id = ?", node.ID).
                UpdateColumn("demotion_warnings", gorm.Expr("demotion_warnings + 1"))
            return node.Tier // Keep current tier
        }
        // Reset counter on actual demotion
        db.DB.Model(&models.ProviderNode{}).Where("id = ?", node.ID).
            UpdateColumn("demotion_warnings", 0)
        return newTier
    }

    // Reset demotion warning on improvement
    if node.DemotionWarnings > 0 {
        db.DB.Model(&models.ProviderNode{}).Where("id = ?", node.ID).
            UpdateColumn("demotion_warnings", 0)
    }
    return newTier
}
```

**Add to ProviderNode model**:
```go
DemotionWarnings int `gorm:"default:0" json:"demotion_warnings"`
```

---

## Phase 7 — Dispute & Review System

### 7.1 Dispute Model

**File**: `services/control-api/internal/models/dispute.go` (new file)

```go
package models

import (
    "time"
    "github.com/google/uuid"
    "gorm.io/gorm"
)

type Dispute struct {
    ID          uuid.UUID      `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
    SessionID   uuid.UUID      `gorm:"type:uuid;index" json:"session_id"`
    ConsumerID  uuid.UUID      `gorm:"type:uuid;index" json:"consumer_id"`
    ProviderID  uuid.UUID      `gorm:"type:uuid;index" json:"provider_id"`
    NodeID      uuid.UUID      `gorm:"type:uuid" json:"node_id"`
    Reason      string         `gorm:"type:varchar(50)" json:"reason"` // no_service, slow_speed, wrong_geo, etc.
    Description string         `gorm:"type:text" json:"description"`
    Status      string         `gorm:"type:varchar(20);default:'open'" json:"status"` // open | resolved | dismissed
    Resolution  string         `gorm:"type:text" json:"resolution,omitempty"`
    RefundSOL   float64        `json:"refund_sol,omitempty"`
    CreatedAt   time.Time      `json:"created_at"`
    ResolvedAt  *time.Time     `json:"resolved_at,omitempty"`
    DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`
}
```

### 7.2 Dispute API Endpoints

**File**: `services/control-api/internal/api/disputes.go` (new file)

```go
func RegisterDisputeRoutes(rg *gin.RouterGroup) {
    rg.POST("/disputes", createDispute)
    rg.GET("/disputes", listMyDisputes)
    rg.GET("/disputes/:id", getDispute)
    rg.POST("/admin/disputes/:id/resolve", resolveDispute) // Admin only
}

// POST /v1/disputes
func createDispute(c *gin.Context) {
    userID, ok := GetUserID(c)
    if !ok { /* ... */ }

    var req struct {
        SessionID   string `json:"session_id" binding:"required"`
        Reason      string `json:"reason" binding:"required"`
        Description string `json:"description"`
    }
    if err := c.ShouldBindJSON(&req); err != nil { /* ... */ }

    // Verify session belongs to this user
    var session models.Session
    if err := db.DB.Where("id = ? AND user_id = ?", req.SessionID, userID).
        First(&session).Error; err != nil {
        c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
        return
    }

    dispute := models.Dispute{
        SessionID:   session.ID,
        ConsumerID:  userID,
        ProviderID:  *session.ProviderUserID,
        NodeID:      *session.ProviderNodeID,
        Reason:      req.Reason,
        Description: req.Description,
        Status:      "open",
    }
    db.DB.Create(&dispute)

    // Increment dispute_count on provider node
    db.DB.Model(&models.ProviderNode{}).
        Where("id = ?", session.ProviderNodeID).
        UpdateColumn("dispute_count", gorm.Expr("dispute_count + 1"))

    c.JSON(http.StatusCreated, dispute)
}
```

---

## Phase 8 — Platform Commission

### 8.1 Commission Configuration

**File**: `services/control-api/internal/config/` — add to config struct:

```go
type BillingConfig struct {
    PlatformFeePercent float64 `env:"PLATFORM_FEE_PERCENT" envDefault:"10.0"`
    MinPayoutSOL       float64 `env:"MIN_PAYOUT_SOL" envDefault:"0.01"`
    PayoutBatchSize    int     `env:"PAYOUT_BATCH_SIZE" envDefault:"50"`
}
```

**`.env.example`**:
```env
PLATFORM_FEE_PERCENT=10.0    # 10% platform commission on all provider earnings
MIN_PAYOUT_SOL=0.01          # Minimum payout amount to trigger disbursement
```

### 8.2 Platform Fee Collection

The `recordProviderEarning()` function in Phase 4.2 already implements this. The platform fee SOL should be routed to the treasury wallet address:

```go
// In recordProviderEarning():
// Platform fee goes to treasury — no separate transfer needed since
// the escrow PDA releases net_amount to provider and platform_fee to treasury atomically
treasuryAddress := os.Getenv("SOLANA_TREASURY_ADDRESS")
// Include in settlement instruction: provider gets netSOL, treasury gets platformFeeSOL
```

---

## Phase 9 — Geographic Routing

### 9.1 Country-Based Node Selection

**File**: `services/control-api/internal/api/session.go` — in the node selection logic.

```go
// When creating a session with target_geo, prefer nodes in that country:
func selectBestNode(targetGeo string, connectionType string) (*models.Node, error) {
    var nodes []models.Node
    query := db.DB.Where("is_healthy = ? AND deleted_at IS NULL", true)

    if connectionType != "" {
        query = query.Where("connection_type = ?", connectionType)
    }

    // Prefer exact country match, fallback to any healthy node
    if targetGeo != "" {
        var geoNodes []models.Node
        query.Where("country_code = ?", targetGeo).
            Order("quality_score DESC").
            Limit(5).
            Find(&geoNodes)

        if len(geoNodes) > 0 {
            nodes = geoNodes
        }
    }

    // No geo match — pick best quality globally
    if len(nodes) == 0 {
        query.Order("quality_score DESC").Limit(10).Find(&nodes)
    }

    if len(nodes) == 0 {
        return nil, fmt.Errorf("no healthy nodes available")
    }

    // Weighted random selection by quality score (avoids always picking same node)
    return weightedRandomNode(nodes), nil
}

func weightedRandomNode(nodes []models.Node) *models.Node {
    totalWeight := 0.0
    for _, n := range nodes {
        totalWeight += n.QualityScore
    }

    randVal := rand.Float64() * totalWeight
    cumulative := 0.0
    for i, n := range nodes {
        cumulative += n.QualityScore
        if randVal <= cumulative {
            return &nodes[i]
        }
    }
    return &nodes[0]
}
```

---

## Phase 10 — CLI Auto-Update & Improvements

### 10.1 Version Check on Startup

**File**: `services/control-api/cmd/provider-cli/cmd/root.go` — add version check in `PersistentPreRun`:

```go
func checkForUpdates(currentVersion string) {
    resp, err := http.Get(apiBase + "/v1/cli/downloads/latest")
    if err != nil {
        return // Silently skip if no internet
    }
    defer resp.Body.Close()

    var latest struct {
        Version string `json:"version"`
    }
    json.NewDecoder(resp.Body).Decode(&latest)

    if latest.Version != "" && latest.Version != currentVersion {
        fmt.Printf("\n⚡ Update available: %s → %s\n", currentVersion, latest.Version)
        fmt.Printf("   Run: proxyhub-provider update\n\n")
    }
}
```

### 10.2 Self-Update Command

**File**: `services/control-api/cmd/provider-cli/cmd/` — add `update.go`:

```go
var updateCmd = &cobra.Command{
    Use:   "update",
    Short: "Update the CLI to the latest version",
    Run: func(cmd *cobra.Command, args []string) {
        fmt.Println("Checking for updates...")
        // 1. Fetch latest version info
        // 2. Download binary for current OS/arch
        // 3. Verify checksum
        // 4. Replace current binary (atomic rename)
        // 5. Print "Updated to vX.Y.Z. Please restart."
    },
}
```

### 10.3 Fix PID File Race Condition

**File**: `services/control-api/cmd/provider-cli/cmd/node.go`

```go
// Use file locking instead of plain PID file:
import "github.com/gofrs/flock"

func acquireStartLock(pidPath string) (*flock.Flock, error) {
    fl := flock.New(pidPath + ".lock")
    locked, err := fl.TryLock()
    if err != nil {
        return nil, err
    }
    if !locked {
        return nil, fmt.Errorf("another instance is already running")
    }
    return fl, nil
}
```

---

## Implementation Checklist

Track progress against this list. Mark each item when merged and deployed.

### Phase 1 — Barriers & Auth
- [ ] Remove any remaining KYC checks from node registration handler
- [ ] Remove email_verified check from node registration
- [ ] Remove IP ownership verification (do not add it)
- [ ] Confirm `kyc.go` and `kyc_test.go` references fully purged from `main.go` route registration
- [ ] Implement `validateJWT()` with Supabase HMAC JWT parsing
- [ ] Add `SUPABASE_JWT_SECRET` to `.env.example` and docker-compose files
- [ ] Replace `time.Now().UnixNano()` nonces with `crypto/rand`
- [ ] Add `github.com/golang-jwt/jwt/v5` to `go.mod`

### Phase 2 — Data Integrity
- [ ] Increment `TotalSessionsServed` on session termination (normal, expired, bandwidth-exhausted)
- [ ] Audit all node SELECT queries for `deleted_at IS NULL` — fix any gaps
- [ ] Add `idempotency_key` to `PendingPayout` model and enforce uniqueness
- [ ] Sync Redis session TTL to DB `expires_at` on write
- [ ] Atomically decrement `available_bandwidth_gb` on listing at session creation
- [ ] Refund unused bandwidth to listing on session termination

### Phase 3 — Heartbeat
- [ ] Add `POST /v1/provider/nodes/:id/heartbeat` endpoint
- [ ] Create `worker/heartbeat_monitor.go` — mark nodes offline after 5-min gap
- [ ] Start heartbeat monitor in `main.go`
- [ ] Add heartbeat loop to CLI `node start` command (every 2 min)

### Phase 4 — Earnings
- [ ] Create `models/provider_earnings.go`
- [ ] Write migration `000030_provider_earnings.up.sql`
- [ ] Add `wallet_address` field to `Node` model + migration
- [ ] Implement `recordProviderEarning()` called on session end
- [ ] Create `api/provider_earnings.go` with summary + history endpoints
- [ ] Wire earnings routes in `main.go`
- [ ] Apply platform fee (10%) in earning calculation

### Phase 5 — Frontend
- [ ] Rewrite `apps/web/src/app/dashboard/provider/page.tsx` — real overview with stats
- [ ] Create `apps/web/src/app/dashboard/earnings/page.tsx` — full earnings table
- [ ] Create/update `apps/web/src/app/dashboard/provider/nodes/page.tsx` — node health cards
- [ ] Add earnings API functions to `apps/web/src/lib/api/provider.ts`
- [ ] Update `Sidebar.tsx` — ensure Earnings nav item links to `/dashboard/earnings`
- [ ] Update `ProviderSetupGuide.tsx` — remove any verification steps; make it 3 steps only: download → register → earn

### Phase 6 — Tier System
- [ ] Fix session count increment (covered in Phase 2)
- [ ] Add tier change notification (insert into notifications table)
- [ ] Add `DemotionWarnings` field to ProviderNode model
- [ ] Implement 2-eval grace period before demotion in `tier_evaluator.go`
- [ ] Migration: add `demotion_warnings` column to provider_nodes table

### Phase 7 — Disputes
- [ ] Create `models/dispute.go`
- [ ] Write migration for disputes table
- [ ] Create `api/disputes.go` with create + list endpoints
- [ ] Admin resolve endpoint (increment/decrement dispute_count accordingly)
- [ ] Wire dispute routes in `main.go`

### Phase 8 — Commission
- [ ] Add `PLATFORM_FEE_PERCENT` to config + `.env.example`
- [ ] Apply fee in `recordProviderEarning()` (Phase 4 covers this)
- [ ] Route platform fee to treasury wallet in settlement instruction

### Phase 9 — Geographic Routing
- [ ] Implement `selectBestNode()` with country-code preference
- [ ] Implement weighted-random node selection by quality score
- [ ] Replace current node selection logic in session creation

### Phase 10 — CLI
- [ ] Add version check on CLI startup (`checkForUpdates`)
- [ ] Add `update` command to CLI
- [ ] Fix PID file race with file locking (`gofrs/flock`)
- [ ] Validate gateway reachability in wizard before completing registration
- [ ] Add reconnect loop in `node start` when gateway connection drops

### Ongoing / Infrastructure
- [ ] Add NATS to `docker-compose.yml` services (monitoring depends on it)
- [ ] Run `go mod tidy` after all dependency additions
- [ ] Write integration test for full session → earning → payout flow
- [ ] Add OpenAPI annotations to all new endpoints
- [ ] Update `PROVIDER_ENGINE_DEEP_DIVE_ANALYSIS.md` to reflect fixed issues

---

## File Creation Summary

| File | Action | Phase |
|------|--------|-------|
| `services/control-api/internal/middleware/provider_token_auth.go` | Modify — implement real JWT | 1 |
| `services/control-api/internal/worker/heartbeat_monitor.go` | **Create new** | 3 |
| `services/control-api/internal/models/provider_earnings.go` | **Create new** | 4 |
| `services/control-api/internal/models/dispute.go` | **Create new** | 7 |
| `services/control-api/internal/api/provider_earnings.go` | **Create new** | 4 |
| `services/control-api/internal/api/disputes.go` | **Create new** | 7 |
| `services/control-api/cmd/provider-cli/cmd/update.go` | **Create new** | 10 |
| `migrations/000030_provider_earnings.up.sql` | **Create new** | 4 |
| `migrations/000030_provider_earnings.down.sql` | **Create new** | 4 |
| `migrations/000031_node_wallet.up.sql` | **Create new** | 4 |
| `apps/web/src/app/dashboard/provider/page.tsx` | Modify — real page | 5 |
| `apps/web/src/app/dashboard/earnings/page.tsx` | **Create new** | 5 |
| `apps/web/src/app/dashboard/provider/nodes/page.tsx` | Create/modify | 5 |
| `apps/web/src/lib/api/provider.ts` | Modify — add earnings fns | 5 |
| `apps/web/src/components/ProviderSetupGuide.tsx` | Modify — simplify steps | 1 |

---

*Implementation plan saved 2026-03-16. Phases are ordered by priority — complete Phase 1 before starting Phase 2.*

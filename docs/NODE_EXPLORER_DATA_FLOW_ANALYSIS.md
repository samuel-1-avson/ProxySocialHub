# Node Activation Not Appearing in Explorer: Root Cause Analysis

## Executive Summary

**Issue**: Nodes activated via CLI/proxy-hub CLI appear successfully in the backend (verified via database queries) but do NOT appear in the `/explorer/nodes` endpoints or the map visualization UI.

**Root Cause**: The system uses a **two-table architecture** with an asynchronous **polling-based synchronization** mechanism. The `NodeSync` service runs every 5 minutes (configurable), creating a significant delay between node registration and explorer visibility. Additionally, there is **no immediate sync trigger** upon node registration.

---

## Data Flow Architecture

### Table Structure

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          TWO-TABLE ARCHITECTURE                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌──────────────────┐         ┌──────────────────────────┐                 │
│   │   nodes Table    │         │    explorer_nodes Table  │                 │
│   │  (Operational)   │         │    (Display/Explorer)    │                 │
│   ├──────────────────┤         ├──────────────────────────┤                 │
│   │ id (UUID)        │         │ id (UUID)                │                 │
│   │ provider_user_id │         │ node_id (string)         │                 │
│   │ ip_address       │         │ chain                    │                 │
│   │ region           │         │ name                     │                 │
│   │ is_healthy       │         │ latitude/longitude       │                 │
│   │ is_registered_on_chain│    │ is_active                │                 │
│   │ last_seen_at     │         │ is_validator             │                 │
│   │ quality_score    │         │ uptime_percent           │                 │
│   │ latency_ms       │         │ active_sessions          │                 │
│   │ deleted_at       │         │ total_bandwidth          │                 │
│   └──────────────────┘         └──────────────────────────┘                 │
│           │                              ▲                                  │
│           │                              │                                  │
│           │       NodeSync Service       │                                  │
│           └──────────────────────────────┘                                  │
│                     (5-min interval)                                         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Write Flow (Node Registration)

```
1. Provider activates node via proxy-hub CLI
        │
        ▼
2. Edge Gateway POST /v1/gateway/nodes/register
        │
        ▼
3. gateway.go: registerGatewayNode()
   - Creates models.Node record
   - Sets: IsHealthy=true, IsRegisteredOnChain=false
   - Sets: deleted_at=NULL (not soft-deleted)
        │
        ▼
4. Record saved to `nodes` table
   - Node is operational for proxy sessions
   - But NOT yet visible in explorer
```

### Read Flow (Explorer Queries)

```
1. User opens /explorer/nodes page
        │
        ▼
2. Frontend calls GET /v1/explorer/nodes/geo
        │
        ▼
3. explorer.go: getExplorerNodesGeo()
   - Queries models.ExplorerNode (explorer_nodes table)
   - Filters: chain='solana', is_active=true (optional)
        │
        ▼
4. Returns nodes from explorer_nodes table only
   - If NodeSync hasn't run yet → EMPTY RESULT
   - If NodeSync has run → Nodes visible
```

---

## NodeSync Service Details

### Configuration (main.go lines 566-582)

```go
nodeSyncInterval := 5 * time.Minute  // DEFAULT: 5 minutes
if interval := os.Getenv("NODE_SYNC_INTERVAL_MINUTES"); interval != "" {
    if mins, err := strconv.Atoi(interval); err == nil {
        nodeSyncInterval = time.Duration(mins) * time.Minute
    }
}

nodeSync := indexer.NewNodeSync(indexer.NodeSyncConfig{
    Interval: nodeSyncInterval,
})
nodeSync.SetCallbacks(indexer.NodeSyncCallbacks{
    OnNodeUpdate: api.NotifyNodeUpdate,  // WS broadcast
})
nodeSync.Start()
```

### Sync Logic (internal/indexer/node_sync.go)

```go
func (ns *NodeSync) syncNodes() error {
    // Query 1: Get all healthy nodes from `nodes` table
    var nodes []models.Node
    if err := ns.db.Where("is_healthy = ?", true).Find(&nodes).Error; err != nil {
        return err
    }

    // Query 2: Sync each node to explorer_nodes
    for _, node := range nodes {
        if err := ns.syncNode(node, sessionStats[node.ID.String()]); err != nil {
            logging.Error(err).Str("node_id", node.ID.String()).Msg("[NodeSync] Failed")
        }
    }

    // Query 3: Mark nodes not in active list as inactive
    if err := ns.markInactiveNodes(nodes); err != nil {
        return err
    }
}
```

### Key Filtering Logic

| Filter | Condition | Effect |
|--------|-----------|--------|
| is_healthy | `= true` | Only healthy nodes synced |
| deleted_at | `IS NULL` | Soft-deleted nodes excluded (GORM default) |
| chain | `= 'solana'` | Only Solana chain nodes in explorer |

---

## Timing Analysis

### Worst Case Latency

```
Node Registered at: 00:00:00
NodeSync Interval:  5 minutes
Next Sync at:       00:05:00
Explorer Visible:   00:05:00
─────────────────────────────
MAX LATENCY:        5 minutes

If NodeSync just ran at 00:00:01:
Next Sync at:       00:05:01
MAX LATENCY:        ~5 minutes
```

### Variables Affecting Visibility

| Variable | Source | Impact |
|----------|--------|--------|
| NODE_SYNC_INTERVAL_MINUTES | Environment | Controls sync frequency |
| is_healthy | Node record | Must be true for sync |
| deleted_at | Node record | Must be NULL (GORM auto-filter) |
| chain | ExplorerNode record | Must be 'solana' for queries |

---

## WebSocket Real-Time Updates

The WebSocket mechanism (`useExplorerWS` hook) receives real-time node updates, but:

```
WS Event Flow:
1. NodeSync.syncNode() creates/updates ExplorerNode
        │
        ▼
2. Callback triggers: api.NotifyNodeUpdate()
        │
        ▼
3. WebSocket broadcasts to connected clients
        │
        ▼
4. Frontend receives node_update event
   - Updates local node map
   - Refreshes markers on globe
```

**Critical**: WS updates only work for nodes that have been synced to `explorer_nodes`. A newly registered node won't generate WS events until the next sync cycle.

---

## Diagnostic Queries

### Check Node in Source Table

```sql
-- Should return the registered node
SELECT id, provider_user_id, ip_address, region, is_healthy, 
       is_registered_on_chain, deleted_at, created_at
FROM nodes
WHERE provider_user_id = '<provider_uuid>'
ORDER BY created_at DESC;
```

### Check Node in Explorer Table

```sql
-- Will return empty until NodeSync runs
SELECT node_id, chain, name, latitude, longitude, is_active, 
       region, country, last_heartbeat
FROM explorer_nodes
WHERE node_id = '<node_uuid>';
```

### Check NodeSync Status

```sql
-- Count nodes waiting to be synced
SELECT COUNT(*) as pending_sync
FROM nodes n
LEFT JOIN explorer_nodes en ON n.id::text = en.node_id
WHERE n.is_healthy = true 
  AND n.deleted_at IS NULL
  AND en.node_id IS NULL;
```

---

## Potential Issues & Solutions

### Issue 1: 5-Minute Delay (Design)

**Problem**: Users expect immediate visibility after node activation.

**Solutions**:

1. **Immediate Sync Trigger** (Recommended)
   ```go
   // In gateway.go registerGatewayNode(), after creating Node:
   if nodeSync != nil {
       go nodeSync.SyncNodeNow(node.ID.String())
   }
   ```

2. **Reduce Sync Interval** (Quick Fix)
   ```bash
   NODE_SYNC_INTERVAL_MINUTES=1  # Sync every minute
   ```

3. **Event-Driven Architecture** (Long-term)
   - Use NATS messaging to trigger sync on node registration
   - Subscribe to node.created events in NodeSync

### Issue 2: IsHealthy Filter

**Problem**: Node may not be synced if `is_healthy` is false.

**Diagnostic**:
```sql
SELECT id, is_healthy, last_seen_at 
FROM nodes 
WHERE provider_user_id = '<uuid>';
```

**Solution**: Check gateway heartbeat is working correctly.

### Issue 3: Soft Delete Filter

**Problem**: If node was created then soft-deleted, GORM auto-filters it.

**Diagnostic**:
```sql
SELECT id, deleted_at 
FROM nodes 
WHERE id = '<node_uuid>';
```

**Solution**: Ensure deleted_at IS NULL.

---

## Code References

### Gateway Registration
- **File**: `services/control-api/internal/api/gateway.go`
- **Function**: `registerGatewayNode()` (lines 32-96)
- **Creates**: `models.Node` with `IsHealthy: true, IsRegisteredOnChain: false`

### Explorer Queries
- **File**: `services/control-api/internal/api/explorer.go`
- **Functions**: 
  - `listExplorerNodes()` (line 780)
  - `getExplorerNodesGeo()` (line 854)
- **Queries**: `models.ExplorerNode{}` table

### NodeSync Service
- **File**: `services/control-api/internal/indexer/node_sync.go`
- **Function**: `syncNodes()` (line 107)
- **Query**: `ns.db.Where("is_healthy = ?", true).Find(&nodes)`

### Service Initialization
- **File**: `services/control-api/main.go`
- **Lines**: 566-582
- **Interval**: 5 minutes (configurable via `NODE_SYNC_INTERVAL_MINUTES`)

### Frontend Service
- **File**: `apps/web/src/lib/services/explorer.ts`
- **Function**: `getNodeGeo()` (line 211)
- **Endpoint**: `GET /v1/explorer/nodes/geo`

---

## Recommended Fixes

### Immediate (Quick Win)

Add immediate sync trigger in `gateway.go`:

```go
func registerGatewayNode(c *gin.Context) {
    // ... existing node creation code ...
    
    // After creating node, trigger immediate sync to explorer
    go func(nodeID string) {
        // Get the NodeSync instance (would need to wire it through)
        if ns := indexer.GetNodeSyncInstance(); ns != nil {
            if err := ns.SyncNodeNow(nodeID); err != nil {
                logging.Error(err).Str("node_id", nodeID).Msg("Immediate node sync failed")
            }
        }
    }(node.ID.String())
    
    c.JSON(http.StatusCreated, gin.H{"node": node})
}
```

### Short-term (Configuration)

Reduce sync interval in environment:

```bash
# .env or docker-compose.yml
NODE_SYNC_INTERVAL_MINUTES=1
```

### Long-term (Architecture)

Implement event-driven sync using NATS:

```go
// In gateway.go
internalNats.Publish("node.registered", node.ID.String())

// In node_sync.go
internalNats.Subscribe("node.registered", func(nodeID string) {
    ns.SyncNodeNow(nodeID)
})
```

---

## Verification Steps

1. **Register a node** via proxy-hub CLI
2. **Check nodes table**: `SELECT * FROM nodes WHERE provider_user_id = '...';`
3. **Wait up to 5 minutes** (or configured interval)
4. **Check explorer_nodes**: `SELECT * FROM explorer_nodes WHERE node_id = '...';`
5. **Refresh explorer page** - node should appear
6. **Check WebSocket** - should receive node_update event

---

## Summary

The "missing node" issue is a **design behavior**, not a bug. The system intentionally separates operational data (`nodes` table) from display data (`explorer_nodes` table) with a background sync process. The 5-minute default interval creates the observed delay.

**Key Takeaways**:
- ✅ Node registration works correctly (creates `nodes` record)
- ✅ Node is operational for proxy sessions immediately
- ⏱️ Explorer visibility has 0-5 minute delay depending on sync timing
- 🔧 Can be reduced via `NODE_SYNC_INTERVAL_MINUTES` env var
- 🚀 True real-time requires event-driven sync implementation

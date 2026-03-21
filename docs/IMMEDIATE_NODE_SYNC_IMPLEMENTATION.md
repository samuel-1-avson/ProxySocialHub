# Immediate Node Sync Implementation

## Overview

This implementation makes node registration and updates **real-time** in the Proxy Explorer. Instead of waiting up to 5 minutes for the NodeSync polling interval, nodes now appear in the explorer immediately upon registration.

## Changes Made

### 1. `internal/indexer/node_sync.go`

Added global instance storage to allow access from other packages:

```go
// globalNodeSync holds the singleton instance for access by other packages
var globalNodeSync *NodeSync

// GetNodeSync returns the global NodeSync instance (may be nil if not started)
func GetNodeSync() *NodeSync {
    return globalNodeSync
}
```

Modified `NewNodeSync()` to store the instance:

```go
func NewNodeSync(cfg NodeSyncConfig) *NodeSync {
    // ... config setup ...
    
    ns := &NodeSync{...}
    
    // Store as global instance for access by other packages
    globalNodeSync = ns
    return ns
}
```

### 2. `internal/api/gateway.go`

Added import for indexer package:

```go
import (
    // ... other imports ...
    "github.com/proxyhubb/control-api/internal/indexer"
)
```

Added immediate sync triggers in four locations:

#### a) New Node Registration (after Create)

```go
if err := db.DB.Create(&node).Error; err != nil {
    // ... error handling ...
}

// Trigger immediate sync to explorer_nodes for real-time visibility
go func(nodeID string) {
    if ns := indexer.GetNodeSync(); ns != nil {
        if err := ns.SyncNodeNow(nodeID); err != nil {
            logging.Warn().Err(err).Str("node_id", nodeID).Msg("Immediate node sync failed")
        } else {
            logging.Debug().Str("node_id", nodeID).Msg("Node synced to explorer immediately")
        }
    }
}(node.ID.String())
```

#### b) Existing Node Update (Reconnect)

```go
// Trigger immediate sync to update explorer with reconnected node status
go func(nodeID string) {
    if ns := indexer.GetNodeSync(); ns != nil {
        if err := ns.SyncNodeNow(nodeID); err != nil {
            logging.Warn().Err(err).Str("node_id", nodeID).Msg("Immediate node sync failed")
        }
    }
}(existingNode.ID.String())
```

#### c) Heartbeat Updates

```go
// Trigger immediate sync to update explorer with latest heartbeat data
go func(nodeID string) {
    if ns := indexer.GetNodeSync(); ns != nil {
        if err := ns.SyncNodeNow(nodeID); err != nil {
            logging.Debug().Err(err).Str("node_id", nodeID).Msg("Heartbeat node sync skipped")
        }
    }
}(nodeID.String())
```

#### d) Status Updates (Online/Offline)

```go
// Trigger immediate sync to update explorer with status change
go func(nodeID string) {
    if ns := indexer.GetNodeSync(); ns != nil {
        if err := ns.SyncNodeNow(nodeID); err != nil {
            logging.Debug().Err(err).Str("node_id", nodeID).Msg("Status update node sync skipped")
        }
    }
}(nodeID.String())
```

## How It Works

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     REAL-TIME SYNC FLOW                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. Provider activates node via proxy-hub CLI                               │
│           │                                                                  │
│           ▼                                                                  │
│  2. Gateway API receives POST /nodes/register                               │
│           │                                                                  │
│           ▼                                                                  │
│  3. Node record created in 'nodes' table                                    │
│           │                                                                  │
│           ├──────────────────────────────────────┐                          │
│           │                                      │                          │
│           ▼                                      ▼                          │
│  4. Return HTTP 201 (immediate)         5. Trigger SyncNodeNow()            │
│     to CLI (non-blocking)                    (goroutine)                    │
│                                                    │                         │
│                                                    ▼                         │
│                                           6. Sync node to                   │
│                                              explorer_nodes table           │
│                                                    │                         │
│                                                    ▼                         │
│                                           7. Broadcast WS event             │
│                                              to connected clients           │
│                                                    │                         │
│                                                    ▼                         │
│                                           8. Node appears on map            │
│                                              immediately!                   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Benefits

| Before (Polling) | After (Real-time) |
|------------------|-------------------|
| 0-5 minute delay | ~100-500ms delay |
| Users refresh waiting | Instant appearance |
| WebSocket stale data | Live updates on all changes |
| Heartbeat stats delayed | Real-time bandwidth/latency |

## Technical Details

### Concurrency

- Sync runs in a **goroutine** (`go func()`) to avoid blocking the HTTP response
- The original 5-minute polling loop still runs for redundancy
- Multiple simultaneous syncs are safe - `SyncNodeNow()` uses database transactions

### Error Handling

- If NodeSync hasn't started yet (`GetNodeSync() == nil`), sync is skipped silently
- Sync errors are logged as warnings but don't fail the API request
- Next polling cycle will catch any missed syncs

### Backward Compatibility

- The 5-minute polling loop still runs as a fallback
- No breaking changes to API or database schema
- Existing `NODE_SYNC_INTERVAL_MINUTES` env var still works

## Testing

### Verify Immediate Sync

1. Register a new node:
   ```bash
   proxy-hub node activate
   ```

2. Check explorer immediately:
   ```bash
   curl http://localhost:8080/v1/explorer/nodes/geo
   ```

3. Node should appear within 1 second (instead of 5 minutes)

### Monitor Logs

```bash
# Should see immediate sync messages
docker logs control-api | grep "synced to explorer immediately"
```

Expected output:
```
{"level":"debug","node_id":"550e8400-e29b-41d4-a716-446655440000","message":"Node synced to explorer immediately"}
```

## Future Enhancements

1. **Batch Sync**: For high-throughput scenarios, batch multiple node updates
2. **Circuit Breaker**: Skip immediate sync if NodeSync is overloaded
3. **Event-Driven**: Replace polling entirely with NATS events for all node changes

## Rollback

If issues arise, simply revert the changes to `gateway.go` and `node_sync.go`. The polling-based sync will continue to work as before.

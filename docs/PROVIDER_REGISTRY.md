# Provider registry — canonical model and consolidation plan

**Canonical table:** `provider_nodes` (seller runtime, heartbeats, geo, `gateway_node_id`, proof fields).

**Legacy / mirror:** `nodes` and explorer `explorer_nodes` rows linked during the D2 transition (`migration 000092`).

## Current behavior

- Gateway registration and heartbeats update **`provider_nodes`** first.
- `reconcileProviderNodeRegistry` mirrors health into explorer-facing tables where configured.
- Public map and marketplace geo read from listings + `provider_nodes` / explorer sync (see [MAP_SYSTEM_DEEP_DIVE_ANALYSIS.md](./reports/MAP_SYSTEM_DEEP_DIVE_ANALYSIS.md)).

## Target state (no big-bang migration)

| Phase | Goal | Owner surface |
|-------|------|----------------|
| **P0 (done)** | Heartbeats and gateway IDs write `provider_nodes.id` | `provider-node`, control-api |
| **P1** | All dashboard/API “node id” fields document UUID = `provider_nodes.id` | Web provider pages, connect endpoint |
| **P2 (done)** | Stop creating orphan `nodes` rows for new registrations; read path uses `provider_nodes` only | `provider_token.go` `getOrCreateNodeID` |
| **P3** | Explorer indexer syncs `provider_nodes` → `explorer_nodes` (`SyncNodeNow` uses canonical id) | `internal/indexer/node_sync.go` |
| **P4 (done)** | Gateway JSON uses `provider_nodes.id` only; `legacy_node_id` removed from register/reconnect responses | `gateway.go` |

## Verification SQL (staging / prod)

```sql
-- Rows with gateway linkage
SELECT id, user_id, gateway_node_id, status, last_seen_at
FROM provider_nodes
WHERE gateway_node_id IS NOT NULL
ORDER BY updated_at DESC
LIMIT 20;

-- Explorer mirror (should reference same provider user / node id where synced)
SELECT node_id, provider_user_id, is_active, last_heartbeat
FROM explorer_nodes
ORDER BY updated_at DESC
LIMIT 20;
```

## When changing registry code

1. Run `scripts/soak-enforce-monitor.ps1` if proofs are enforced.
2. Run provider contract test: `go test ./internal/api/... -run TestProviderNodeAPIContract` (control-api).
3. Confirm map pins still resolve: marketplace geo + explorer map smoke.

Do **not** add a third node table; extend `provider_nodes` columns or JSON metadata instead.

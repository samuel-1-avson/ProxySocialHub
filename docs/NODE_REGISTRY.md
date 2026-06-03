# Node registry — canonical model

**Status:** Active guidance (June 2026)  
**Goal:** One canonical runtime/product node identity for providers, operators, and agents.

---

## Canonical table plus compatibility mirror

| Table | Role | Who writes it | Primary key used by |
|-------|------|---------------|---------------------|
| **`provider_nodes`** | Canonical dashboard + gateway runtime registry (name, geo, status, `gateway_node_id`, pricing, health, port, bytes, active connections) | Provider API, provider heartbeat, edge-gateway registration/heartbeat | Listings (`provider_node_id`), marketplace geo, provider dashboard, CLI `node_id`, gateway heartbeat ID, explorer sync |
| **`nodes`** | Legacy compatibility mirror during rollout | Edge-gateway registration mirrors writes while older readers are removed | Legacy analytics/read paths only |

**Compatibility column:** `nodes.provider_node_id` → `provider_nodes.id`  
**Runtime migration:** `migrations/000092_provider_nodes_runtime_merge.*.sql`

```text
Provider dashboard                    Edge gateway
      |                                    |
      v                                    v
provider_nodes  ---> nodes compatibility mirror
      |
      +-------- listings.provider_node_id
      |
      +-------- explorer_nodes.node_id
```

---

## Canonical rules (enforce in ops + CLI)

1. **Provider-facing ID** is always **`provider_nodes.id`** (UUID from dashboard or `GET /v1/provider/nodes/:id/connect`).
2. **`provider.toml`** must set `node_id` to that UUID — not a gateway row id, not `node_<user_uuid>` unless that is explicitly stored as `gateway_node_id` on the row.
3. **Gateway tunnel identity** is `gateway_node_id` on `provider_nodes` (often `node_<user_uuid>` from `providerGatewayNodeID()`). The gateway may mirror this on `nodes.gateway_node_id` during the compatibility window.
4. **New listings** must use `provider_node_id` (see `resolveListingProviderNode` in `listings.go`).
5. **Do not** create marketplace listings without at least one `provider_nodes` row for the seller.

When the gateway registers or heartbeats, `gateway.go` upserts **`provider_nodes` first** and returns `provider_nodes.id` as the canonical `id`. `legacy_node_id` is returned only for observability.

---

## Troubleshooting “dashboard offline, gateway online”

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Dashboard node offline | Heartbeat uses wrong UUID | Match `provider.toml` `node_id` to dashboard node id |
| Gateway shows node, dashboard does not | Old gateway is still using a legacy `nodes.id` | Re-register tunnel; new registration returns `provider_nodes.id` |
| Multiple nodes per user | Ambiguous `resolveProviderNodeForGateway` | Set explicit `gateway_node_id` on the row you use; delete stale rows |
| Analytics country wrong | Query still reads the legacy mirror | Prefer `provider_nodes` for seller-facing metrics; leave `nodes` reads only as rollout compatibility |

---

## Code references

| Area | File |
|------|------|
| Link + sync | `internal/api/provider_registry.go` |
| Provider CRUD | `internal/api/provider_nodes.go` |
| Listing attach | `internal/api/listings.go` |
| Gateway runtime model | `internal/models/features.go` (`ProviderNode`) |
| Legacy mirror model | `internal/models/node.go` (`ProviderNodeID`) |
| Stale offline | `internal/worker/stale_duration.go` |

---

## Compatibility window

The merge path is implemented, but the legacy `nodes` table remains during rollout so older analytics and gateway readers do not break. Later cleanup can:

- Remove remaining legacy `nodes` joins.
- Drop the compatibility mirror after one release with monitoring.
- Keep `gateway_node_id` as the stable tunnel key across IP changes.

Treat **`provider_nodes` as source of truth** for product flows, gateway heartbeats, explorer sync, and marketplace buying.

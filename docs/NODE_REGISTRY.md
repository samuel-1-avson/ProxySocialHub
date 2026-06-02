# Node registry — canonical model

**Status:** Active guidance (May 2026)  
**Goal:** One mental model for providers, operators, and agents — avoid mixing dashboard UUIDs with gateway runtime rows.

---

## Two tables, one link

| Table | Role | Who writes it | Primary key used by |
|-------|------|---------------|---------------------|
| **`provider_nodes`** | Dashboard / API registration (name, geo, status, `gateway_node_id`, pricing) | Provider via `POST /v1/provider/nodes`, heartbeat, connect package | Listings (`provider_node_id`), marketplace geo, provider dashboard, CLI `node_id` in `provider.toml` |
| **`nodes`** | Gateway runtime registry (IP, ports, health, tiers, on-chain flags) | Edge-gateway registration + sync workers | Usage analytics (legacy joins), smart routing, indexer sync |

**Bridge column:** `nodes.provider_node_id` → `provider_nodes.id`  
**Bridge function:** `linkGatewayNodeToProviderNode` in `services/control-api/internal/api/provider_registry.go`

```text
Provider dashboard                    Edge gateway
      |                                    |
      v                                    v
 provider_nodes  <--- provider_node_id --- nodes
      |                                    |
      +-------- listings.provider_node_id -+
```

---

## Canonical rules (enforce in ops + CLI)

1. **Provider-facing ID** is always **`provider_nodes.id`** (UUID from dashboard or `GET /v1/provider/nodes/:id/connect`).
2. **`provider.toml`** must set `node_id` to that UUID — not a gateway row id, not `node_<user_uuid>` unless that is explicitly stored as `gateway_node_id` on the row.
3. **Gateway tunnel identity** is `gateway_node_id` on `provider_nodes` (often `node_<user_uuid>` from `providerGatewayNodeID()`). The gateway also stores this on `nodes.gateway_node_id`.
4. **New listings** must use `provider_node_id` (see `resolveListingProviderNode` in `listings.go`).
5. **Do not** create marketplace listings without at least one `provider_nodes` row for the seller.

When the gateway sees traffic, `syncProviderNodeFromGateway` updates **`provider_nodes.status`** and `last_seen_at` so the dashboard matches tunnel activity.

---

## Troubleshooting “dashboard offline, gateway online”

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Dashboard node offline | Heartbeat uses wrong UUID | Match `provider.toml` `node_id` to dashboard node id |
| Gateway shows node, dashboard does not | `provider_node_id` not set on `nodes` row | Re-register tunnel; check `linkGatewayNodeToProviderNode` logs |
| Multiple nodes per user | Ambiguous `resolveProviderNodeForGateway` | Set explicit `gateway_node_id` on the row you use; delete stale rows |
| Analytics country wrong | Query joins `nodes` instead of `provider_nodes` | Prefer `provider_nodes` for seller-facing metrics (see `marketplace_geo.go`, `listing_sla.go`) |

---

## Code references

| Area | File |
|------|------|
| Link + sync | `internal/api/provider_registry.go` |
| Provider CRUD | `internal/api/provider_nodes.go` |
| Listing attach | `internal/api/listings.go` |
| Gateway model | `internal/models/node.go` (`ProviderNodeID`) |
| Dashboard model | `internal/models/features.go` (`ProviderNode`) |
| Stale offline | `internal/worker/stale_duration.go` |

---

## Future consolidation (optional)

Full merge of `nodes` into `provider_nodes` is **not** required for wallet launch. If undertaken later:

- Migrate usage `node_id` FK to `provider_nodes.id` where still pointing at `nodes.id`
- Retire duplicate geo fields
- Keep `gateway_node_id` as the stable tunnel key across IP changes

Until then, treat **`provider_nodes` as source of truth for product flows** and **`nodes` as gateway operational cache** linked by `provider_node_id`.

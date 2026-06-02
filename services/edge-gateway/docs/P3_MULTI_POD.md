# P3 — Multi-pod scale-out

Blueprint: [`EDGE_GATEWAY_VNEXT_BLUEPRINT.md`](../../../docs/EDGE_GATEWAY_VNEXT_BLUEPRINT.md) §10 P3.

## Goal

Buyers can hit **any** edge pod; providers connected to **one** pod are reachable fleet-wide. Phase **P3a (co-located)** keeps one binary/image but adds a **shared Redis provider directory** and owner-pod forwarding. Phase **P3b** splits tunnel-gw vs edge-ingress later.

## Slices

| Slice | Status | Deliverable |
|-------|--------|-------------|
| **P3.0** | Done | Stable `EDGE_POD_ID`, Redis `eg:provider:owner:{node_id}` claim/release on tunnel connect/disconnect |
| **P3.1** | Done | Directory-backed selection (`ProviderTarget`, Redis metadata + fleet list) |
| **P3.2** | Done | Internal forward hop (`bridge.internal` CONNECT + `EDGE_PEER_URLS`) |
| **P3.3** | Done | `docker-compose.p3-multipod.yml` + `scripts/p3-multipod-smoke.*` |
| **P3.4** | Done | Horizontal scale benchmark (`p3-scale-benchmark.*`) |
| **P3.5** | Done | Pod drain + ownership migration (`pod_drain`, `p3-pod-drain.*`) |

## Env

```bash
# Stable pod identity (K8s: set from downward API)
EDGE_POD_ID=edge-gateway-abc123
# Or HOSTNAME / POD_NAME when unset

# single (default): directory written for observability only
# colocated: select from Redis directory; forward to owner pod when needed
EDGE_MODE=single|colocated

# TTL refreshed on claim + heartbeats
PROVIDER_DIRECTORY_TTL_SECS=120

# Peer map for P3.2 (comma-separated pod@base_url)
EDGE_PEER_URLS=edge-a@http://edge-a:8090,edge-b@http://edge-b:8090
```

## Verify

```bash
cargo test ownership_key parse_peer_url
# Two-pod stack:
docker compose -f docker-compose.p3-multipod.yml up -d --build
./scripts/p3-multipod-smoke.sh   # or p3-multipod-smoke.ps1 on Windows
./scripts/p3-scale-benchmark.ps1 # directory fan-out + dual-pod health load
./scripts/p3-pod-drain.ps1       # drain edge-a, release Redis ownership, re-home on edge-b
```

### Pod drain (K8s preStop)

With `ENABLE_DEBUG_ROUTES=true` or `ENABLE_POD_DRAIN_ADMIN=true`:

1. `POST /admin/drain` — set draining; `/health` → **503**, `/ready` → not ready; reject new buyer/tunnel accepts.
2. Wait for `ACTIVE_SESSIONS` → 0 (existing 30s shutdown loop on SIGTERM).
3. `POST /admin/drain/ownership` — release all `eg:provider:owner:*` keys for this `EDGE_POD_ID` (ownership migration).
4. Providers reconnect to another pod and claim fresh keys.

On **SIGTERM**, step 1 runs automatically, then session drain, then directory release (colocated mode).

`GET /debug/directory/stats` — fleet directory counts per pod (debug builds).

Default host ports (do not overlap `docker-compose.resilience.yml`):

| Pod   | Buyer HTTP | Provider tunnel |
|-------|------------|-----------------|
| edge-a | 28090      | 23128           |
| edge-b | 28091      | 23129           |
| Redis  | 26379      | —               |

If `edge-a` fails with “port already allocated”, stop the resilience stack (`docker compose -f docker-compose.resilience.yml down`) or only run one compose file at a time.

### Container name conflicts

Older compose files used fixed `container_name: proxyhubb-p3-*`, which conflicts when you switch compose projects (`edge-gateway` vs `edge-p3`). Fix:

```powershell
.\scripts\p3-multipod-down.ps1 -RemoveLegacy
.\scripts\p3-multipod-up.ps1 -Build
```

Scripts resolve Redis/edge containers via `docker compose -p edge-p3 ps -q` (see `scripts/p3-compose.ps1`).
```

## P2 leftovers (can run in parallel)

- Unified circuit breaker env (`CB_*`)
- DDoS challenge enforcement
- Admission soak / extended chaos

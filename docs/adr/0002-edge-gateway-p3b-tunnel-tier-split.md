# ADR 0002 — P3b Tunnel Tier Split (`EDGE_MODE=split`)

- **Status:** Accepted (P3b PR 1–4)
- **Date:** 2026-06-02
- **Supersedes:** none
- **Related:** [ADR 0001](0001-edge-gateway-scope-and-ports.md), [`EDGE_GATEWAY_VNEXT_BLUEPRINT.md`](../EDGE_GATEWAY_VNEXT_BLUEPRINT.md) §11, [`P3b_TUNNEL_SPLIT.md`](../../services/edge-gateway/docs/P3b_TUNNEL_SPLIT.md)

---

## Context

**P3a (colocated)** runs buyer HTTP and provider yamux on the same replica. Cross-pod reachability uses `EDGE_PEER_URLS` and `bridge.internal` forwarding to the directory owner pod.

**P3b** separates concerns for scale and blast radius:

| Tier | Responsibility | Today (P3a) | Target (P3b) |
|------|----------------|-------------|--------------|
| **Ingress** | Auth, policy, buyer CONNECT/WS, metering | Same process as tunnel | Dedicated `edge-*` pool |
| **Tunnel** | Provider yamux, local registry, directory writes | Same process as ingress | Dedicated `tunnel-gw-*` pool |

Without an ADR, env vars (`EDGE_MODE`, `EDGE_ROLE`, `TUNNEL_GW_ADDRS`) would drift from compose and K8s the same way ports did before ADR 0001.

## Decision

### D1 — `EDGE_MODE=split` (Accepted for PR 1)

| Value | Meaning |
|-------|---------|
| `single` | One replica; no shared directory (default). |
| `colocated` | P3a multipod; directory + peer forward. |
| `split` | P3b; ingress and tunnel pools are distinct deployments. |

Aliases: `multipod` → `colocated`; `p3b` → `split`.

### D2 — `EDGE_ROLE` when split (Accepted for PR 1)

| Role | Listeners (PR 1) | Notes |
|------|------------------|-------|
| `ingress` | Buyer HTTP on `PORT`; **no** `TUNNEL_PORT` | Providers must not dial ingress pods. |
| `tunnel` | `TUNNEL_PORT` + HTTP on `PORT` for `/health` / `/metrics` | Public buyer CONNECT/WS return **403** (P3b.2). |

`EDGE_ROLE` is required when `EDGE_MODE=split`. Accepted values: `ingress` / `edge` / `buyer` and `tunnel` / `tunnel-gw` / `provider`.

### D3 — `TUNNEL_GW_ADDRS` (Accepted for PR 1)

Same encoding as `EDGE_PEER_URLS`:

```text
TUNNEL_GW_ADDRS=tunnel-a@http://tunnel-a:8090,tunnel-b@http://tunnel-b:8090
```

Ingress pods use this map in **P3b.3** to open sessions on the owning tunnel tier instead of `EDGE_PEER_URLS` + colocated forward.

PR 1 only parses and logs the map; routing still follows P3a colocated paths if misconfigured.

### D4 — Compose project `edge-p3-split` (Accepted for PR 1)

Sketch file: `services/edge-gateway/docker-compose.p3-split.yml`.

Host ports (non-overlapping with `edge-p3` / dev gateway):

| Service | Buyer HTTP (host) | Tunnel (host) |
|---------|-------------------|---------------|
| `edge-a` / `edge-b` | 28100 / 28101 | — |
| `tunnel-a` / `tunnel-b` | 28110 / 28111 (health) | 23228 / 23229 |
| Redis | 26479 | — |

### D5 — Deferred to follow-up PRs

| Item | PR |
|------|-----|
| Ingress → tunnel internal API (`owner_forward_base_url` + `bridge.internal`) | P3b.3 (done) |
| Reject buyer CONNECT on `EDGE_ROLE=tunnel` | P3b.2 (done) |
| P3 split smoke / sign-off | P3b.4 (done) |
| K8s manifests for split tiers | P3b.5 |

## Consequences

- **Positive:** Clear env contract before routing work; ingress pods shed provider TCP load.
- **Negative:** Two pools to deploy and observe; mis-set `EDGE_ROLE` fails fast at startup.
- **Neutral:** Same binary/image for both tiers until optional slim tunnel image is justified.

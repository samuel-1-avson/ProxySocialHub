# P4 — Provider transport sign-off

Blueprint: [EDGE_GATEWAY_VNEXT_BLUEPRINT.md](../../../docs/EDGE_GATEWAY_VNEXT_BLUEPRINT.md) §5.8.

## Scope delivered

| Item | Status |
|------|--------|
| Multi-yamux per provider (`YAMUX_CONNS_PER_NODE`, `YamuxMux`) | Done |
| Round-robin stream open (`pick_control`) | Done |
| Tunnel attach for extra provider TCP/QUIC sessions | Done |
| `provider-node` multi-dial (primary first, then attach lanes) | Done |
| Quinn QUIC listener + provider-node QUIC client | Done |
| Docker QUIC stack (`docker-compose.provider.yml`, `compose-up-dev.ps1`) | Done |
| `transport_bench` + `p4-transport-exit-verify.*` | Done |
| Transport soak runbook + `p4-transport-soak.ps1` | Done |
| Dev transport soak (20 CONNECT × 45s, QUIC overlay) | Done — [`P4_TRANSPORT_SOAK.md`](P4_TRANSPORT_SOAK.md) 2026-06-03 |
| `get_best` / shard routing uses `pick_control` | Done |

## Deferred (post-P4)

| Item | Notes |
|------|--------|
| Raw-TCP elephant flow fast path | Blueprint §5.8(b) follow-up |
| 10k+ stream load-lab soak | Dev script supports `SOAK_CONCURRENT`; record on dedicated hardware |

## Configuration

Gateway and provider-node both honor:

- `YAMUX_CONNS_PER_NODE` (1–16, default 1)
- `PROVIDER_TRANSPORT=yamux|quic` (quic requires `--features quic` build)

## Verification

```powershell
cd services/edge-gateway
.\scripts\p4-transport-exit-verify.ps1
```

```powershell
# From repo root — live QUIC + soak
.\scripts\quic-provider-e2e-docker.ps1 -SkipHeal
cd services/edge-gateway
.\scripts\p4-transport-soak.ps1
```

Manual smoke (2 lanes):

1. Start gateway with `YAMUX_CONNS_PER_NODE=2` (use provider compose overlay).
2. Start provider-node with `YAMUX_CONNS_PER_NODE=2`.
3. Confirm gateway logs: one `Provider connected`, one `mux lane attached` with `lanes=2`.
4. Run a buyer CONNECT; confirm traffic flows.

## ADR

[0003-provider-transport-multiyamux.md](../../../docs/adr/0003-provider-transport-multiyamux.md)

## Soak

[`P4_TRANSPORT_SOAK_RUNBOOK.md`](P4_TRANSPORT_SOAK_RUNBOOK.md), snapshots in [`P4_TRANSPORT_SOAK.md`](P4_TRANSPORT_SOAK.md).

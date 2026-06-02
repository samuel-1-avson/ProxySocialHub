# P4 — Provider transport sign-off

Blueprint: [EDGE_GATEWAY_VNEXT_BLUEPRINT.md](../../../docs/EDGE_GATEWAY_VNEXT_BLUEPRINT.md) §5.8.

## Scope delivered

| Item | Status |
|------|--------|
| Multi-yamux per provider (`YAMUX_CONNS_PER_NODE`, `YamuxMux`) | Done |
| Round-robin stream open (`pick_control`) | Done |
| Tunnel attach for extra provider TCP sessions | Done |
| `provider-node` multi-dial (primary first, then attach lanes) | Done |
| `PROVIDER_TRANSPORT` + `--features quic` stub | Done |
| `transport_bench` + `p4-transport-exit-verify.*` | Done |
| `get_best` / shard routing uses `pick_control` | Done |

## Deferred (post-P4)

| Item | Notes |
|------|--------|
| Quinn QUIC listener | `quic_listener` placeholder; yamux remains production path |
| Raw-TCP elephant flow fast path | Blueprint §5.8(b) follow-up |
| Transport soak at 10k+ streams | Run under load lab; record in runbook |

## Configuration

Gateway and provider-node both honor:

- `YAMUX_CONNS_PER_NODE` (1–16, default 1)
- `PROVIDER_TRANSPORT=yamux|quic` (gateway only; quic requires `--features quic`)

## Verification

```powershell
cd services/edge-gateway
.\scripts\p4-transport-exit-verify.ps1
```

```powershell
cd services/provider-node
cargo test
cargo build
```

Manual smoke (2 lanes):

1. Start gateway with `YAMUX_CONNS_PER_NODE=2`.
2. Start provider-node with `YAMUX_CONNS_PER_NODE=2` pointing at the gateway.
3. Confirm gateway logs: one `Provider connected`, one `mux lane attached` with `lanes=2`.
4. Run a buyer CONNECT; confirm traffic flows.

## ADR

[0003-provider-transport-multiyamux.md](../../../docs/adr/0003-provider-transport-multiyamux.md)

# P4 — Provider transport

Blueprint: [EDGE_GATEWAY_VNEXT_BLUEPRINT.md](../../../docs/EDGE_GATEWAY_VNEXT_BLUEPRINT.md) §5.8, phase P4.

## Goals

| Item | Status |
|------|--------|
| Multi-yamux per provider (`YAMUX_CONNS_PER_NODE`) | Done (gateway) |
| Round-robin stream sharding | Done |
| `provider-node` multi-dial | Done |
| `PROVIDER_TRANSPORT` + `quic` feature flag | Done (stub) |
| Sign-off | [`P4_SIGNOFF.md`](P4_SIGNOFF.md) |
| QUIC listener (`quinn`) | Post-P4 |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `YAMUX_CONNS_PER_NODE` | `1` | Parallel yamux/TCP sessions per registered provider (max 16). |
| `PROVIDER_TRANSPORT` | `yamux` | `yamux` or `quic`. `quic` requires `cargo build --features quic` for future listener. |

## Behavior

1. **First connection** — normal AUTH/CAPABILITY handshake, `registry.insert(..., max_lanes)`, directory claim, control-api registration.
2. **Extra connection** (same `node_id`) — allowed when `YAMUX_CONNS_PER_NODE > 1` and lane count &lt; max; `try_attach_mux_lane`. Rejected when max is 1 or mux is full.
3. **Buyer streams** — `get_by_id` / `get_random` / etc. call `pick_control()` for round-robin across lanes.

## Verify

```powershell
cd services/edge-gateway
cargo test yamux_mux provider_transport
cargo bench --bench transport_bench -- --test
```

```bash
./scripts/p4-transport-exit-verify.sh
```

## Follow-ups

- Quinn QUIC listener behind `--features quic`
- Scale soak (10k+ streams) in load lab
- Raw-TCP elephant-flow fast path (blueprint §5.8)

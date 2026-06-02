# ADR 0003: P4 provider transport — multi-yamux and QUIC feature flag

## Status

Accepted (P4 PR 1 — gateway side)

## Context

Each provider today opens one TCP connection and one yamux session. All buyer streams multiplex on that session, which limits throughput under window pressure and head-of-line blocking ([EDGE_GATEWAY_VNEXT_BLUEPRINT.md](../EDGE_GATEWAY_VNEXT_BLUEPRINT.md) §5.8).

## Decision

1. **Multi-yamux (default path):** `YAMUX_CONNS_PER_NODE` (1–16, default 1) allows multiple parallel yamux controls per `node_id`. Additional provider TCP handshakes call `try_attach_mux_lane`; stream opens use round-robin `pick_control()`.
2. **QUIC (optional):** `PROVIDER_TRANSPORT=quic` is recognized at startup. The `quic` Cargo feature gates future quinn integration; without it, the gateway logs a warning and continues on yamux/TCP.
3. **Provider-node:** must dial `N` times when `YAMUX_CONNS_PER_NODE>1` (follow-up in `provider-node`).

## Consequences

- **Positive:** Higher per-provider throughput without changing buyer ingress; backward compatible when `YAMUX_CONNS_PER_NODE=1`.
- **Negative:** Score snapshots still key off the primary lane; extra lanes only affect `pick_control()` paths until snapshot work shards controls.
- **Operational:** Tune `YAMUX_CONNS_PER_NODE` with provider connection count and load tests (`transport_bench`, soak).

## References

- `services/edge-gateway/src/provider_transport/`
- `services/edge-gateway/docs/P4_PROVIDER_TRANSPORT.md`

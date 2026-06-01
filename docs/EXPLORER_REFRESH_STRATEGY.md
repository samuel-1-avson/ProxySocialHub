# Explorer refresh strategy

How live data reaches the public explorer UI and API without duplicate work or misleading labels.

## Layers

| Layer | TTL / trigger | Used for |
|-------|----------------|----------|
| **WebSocket** (`/v1/explorer/ws`) | Push on events | Dashboard blocks, recent txs, node/geo hints when connected |
| **Redis** | 10–30s (endpoint-specific) | `GET /metrics`, network health, decentralization snapshots |
| **`explorer_metrics` job** | `EXPLORER_METRICS_INTERVAL` (default 10m) | Hourly aggregates: wallets in period, nodes, bandwidth bytes in period, fees |
| **Live SQL fallback** | On cache miss only | `GET /metrics` when no hourly row exists |

## Client rules (dashboard)

1. Prefer WS payloads for blocks and transaction lists when the socket is open.
2. Poll REST only for metrics not on the wire (bandwidth totals, decentralization, health).
3. Do not double-fetch the same resource on the same interval from WS and HTTP.

## Metric semantics (public API)

| Field | Meaning |
|-------|---------|
| `transactions_per_second` | Confirmed non-orphaned txs in last **24h** ÷ 86400 |
| `tps_window_hours` | Always `24` for live path; documents the TPS window |
| `active_wallets` | Distinct from/to addresses in last **24h** (not `wallets` table count) |
| `total_bandwidth_gb` (metrics) | Sum of node **lifetime** `total_bandwidth` counters |
| `last_24h_bandwidth_gb` (bandwidth) | Sum of `usage_records.bytes_used` in requested `period` |
| `avg_throughput_mbps` | Period bytes × 8 / period seconds / 1e6 |

## Operator knobs

- `EXPLORER_METRICS_INTERVAL` — indexer aggregation cadence
- `FULL_DECENTRALIZATION` / `EXPLORER_MIN_WRITERS` — gate for `/metrics` and related routes
- Redis availability — shorter TTLs when present; DB-only when not

## Related

- [EXPLORER_IMPLEMENTATION_PLAN.md](EXPLORER_IMPLEMENTATION_PLAN.md)
- [EXPLORER_VERIFICATION.md](EXPLORER_VERIFICATION.md)

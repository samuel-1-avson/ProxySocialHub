# ADR 0007: Map network topology visualization

**Status:** Proposed
**Date:** 2026-06-06
**Context:** Phase 3 removed decorative globe arcs. Phase 5 will add **real** topology when data exists. Multiple signals exist (session intents, gateway heartbeats, future on-chain gateways) but no unified model.

## Decision

1. **No synthetic topology.** If `map_node_links` is empty or `topology_available` is false, render **zero** arcs. Never fall back to hub-and-spoke or “nexus” decoration.

2. **Aggregated region-pair links only.** Public map shows edges between **regional hubs** (same precision floor as pins), derived from active `session_intents` in Phase 5a. Per-session or per-IP geometry is out of scope.

3. **Materialized table + poll/WS.** Persist links in `map_node_links` with rolling time windows. Clients fetch `GET /v1/map/links` (cap 50) and optionally subscribe to `link_update` on explorer WS.

4. **Feature flag default off.** `NEXT_PUBLIC_GLOBE_TOPOLOGY=false` until staging validates data quality and privacy copy.

5. **Globe-first.** Initial rendering in `GlobeScene` via react-globe.gl `arcsData`. 2D polylines deferred.

## Rationale

- Session intents already record `provider_node_id` + `target_geo` at route time — sufficient for honest “where demand meets supply” visualization without new edge-gateway work.
- Aggregating protects buyer privacy and keeps arc count bounded.
- Materialized rows decouple map reads from heavy session joins and match the existing `node_update` pattern.

## Consequences

- New migration, aggregator job, API route, and frontend hook.
- Edge-gateway peering ingest (Phase 5c) is additive — new `link_kind`, same table.
- Product must label arcs as **aggregated active sessions**, not real-time packet paths.

## Alternatives considered

| Option | Rejected because |
|--------|------------------|
| Draw arcs directly from live session query | Too heavy; leaks session count spikes; hard to cap at 50 |
| Client-side link inference from pins | Duplicates hub logic; dishonest when coords differ by surface |
| Re-enable decorative nexus arcs as placeholder | Violates Phase 3 honesty goal; confuses operators |
| On-chain gateways first | `GetFederatedGateways()` stub; blocks delivery for months |

## References

- [MAP_GEO_OPERATIONS.md](../MAP_GEO_OPERATIONS.md)
- [reports/PHASE_IMPLEMENTATION_STATUS.md](../reports/PHASE_IMPLEMENTATION_STATUS.md)

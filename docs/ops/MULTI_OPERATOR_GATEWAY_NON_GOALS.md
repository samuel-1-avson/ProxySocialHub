# Multi-operator gateway — shipped vs deferred (Wave 5.B)

Companion to [ADR 0007](../adr/0007-multi-operator-gateways.md).

## Wave 5.B ships

| Item | Notes |
|------|--------|
| Operator discovery API | `GET /v1/gateways/operators` (+ `:id`) — centralized Postgres |
| J2 logical operators | Two seeded operators mapped to edge-a / edge-b |
| Tunnel addrs from registry | Merged into provider connect-info (env CSV remains fallback) |
| Peer-forward CONNECT soak | Live proof provider-on-A / buyer-on-B — **PASS** (`W5B_PEER_FORWARD_OK`) |
| Stake / slash **hooks** | `bonded` fields + optional bond-enforce filter; honeytoken → `slashing_events` audit |

## Still deferred (→ Wave 6+)

| Claim | Why deferred | Tracked in |
|-------|----------------|------------|
| Independent host / org operators | Needs second fleet + out-of-band trust; W5.B is same-VM logical ops | **Wave 6** (`WAVE6_DECENTRALIZATION_PLAN.md`) |
| Live stake / slash economics | Bonded program localnet soak; GCP execute off; `programs/session` unsafe | **Wave 8** (`WAVE8_DECENTRALIZATION_PLAN.md`) |
| Trustless gateway selection | Central control-api still SoT for sessions/orders | **Wave 7 A–C claimed** (verify local; mint may still be API). Live foreign org still open (W7.D). [`WAVE7_DECENTRALIZATION_PLAN.md`](WAVE7_DECENTRALIZATION_PLAN.md) |
| Multi-region mesh | Host SPOF accepted in W5; dual-host only in W6 | Wave 6+ |
| “DePIN ready” marketing | Would overclaim vs hybrid score | Forbidden through Wave 7 (still forbidden after A–C) |

Wave 2 delivered: same-VM multipod overlay, hydrate reaper, sticky CONNECT, peer-URL wiring.
Wave 5.B adds discovery + soak + observe hooks on top — not DePIN.
Wave 6 targets **distinct hosts** + attested operators + cross-host soak — still not DePIN.
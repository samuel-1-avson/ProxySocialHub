# 12 — Event & Real-Time Communication Audit

**Transports:** NATS JetStream (primary), Redis Streams + Pub/Sub (secondary), WebSocket hubs (client-facing). No Kafka.

## 1. Event Catalogue

| Event / Subject | Producer | Consumer | Schema | Delivery | Idempotent consumer | DLQ | Status |
|-----------------|----------|----------|--------|----------|--------------------|-----|--------|
| `proxy.sessions.v1.created` | `session_service.go:88` | `provision_worker.go:61` | JSON | JetStream ≥1× | session row exists | none | OK |
| `proxy.sessions.v1.terminated` | `session_service.go:113` | `provision_worker.go:65` | JSON | JetStream | — | none | OK |
| `proxy.settlement.v1.receipts.created` | `settlement/coordinator.go:118` | `settlement_coordinator_worker.go:33` | `ReceiptCreatedEvent` | JetStream | receipt unique nonce | none | OK |
| `proxy.settlement.v1.manifests.coordinated` | `coordinator.go:177` | **none** | `ManifestCoordinatedEvent` | JetStream | — | none | **orphan (EV-02)** |
| `proxy.telemetry.v1.heartbeat` | `provider_nodes.go:612` | `marketplace_watcher.go:38` | JSON | JetStream (24h) | — | none | OK |
| `proxy.telemetry.v1.alerts` | `watchtower.go:92`, `reconciliation.go:350` | **none (monitoring reads only)** | map | JetStream | — | none | **weak (EV-03-adjacent)** |
| `proxy.messaging.v1.broadcast` | `ws/hub.go:181-192` | `ws/hub.go:140` | WS msg | JetStream | — | none | OK |
| `proxy.treasury.v1.topup` | `treasury_manager.go:261,324` | **none** | map | **no matching stream** | — | none | **broken (EV-01)** |
| `proxy.treasury.v1.reconciliation` | `reconciliation.go:346` | **none** | report | **no matching stream** | — | none | **broken (EV-01)** |
| Redis `events:bandwidth.consumed` | `usage.go:199` | `worker.go:44` (log-only) | stream entry | Streams+CG, XACK | loose ID window | none | produced; consumer non-durable for money (EV-03) |
| Redis `user.loggedin` | **none found** | `worker.go:34` | — | Streams | — | none | **consumed-never-produced (EV-04)** |
| Redis `user.registered`, `session.*`, `listing.*`, `order.*` | constants only | none | — | — | — | none | dead types |
| WS `/v1/explorer/ws` → clients | explorer indexer/hub | browser | JSON | best-effort | n/a | n/a | OK (public) |
| WS `/v1/ws` → clients | ws hub | browser | JSON | best-effort | n/a | n/a | **client never authenticates (FE-01)** |

## 2. Platform-Level Assessment

| Aspect | Verdict |
|--------|---------|
| Schema versioning | Subject names carry `v1`; payloads unversioned/unvalidated — add JSON-schema or protobuf contracts |
| Ordering | Per-subject only; no cross-stream ordering guarantees (acceptable) |
| Deduplication | Settlement receipts idempotent via unique nonce; other consumers rely on natural idempotency |
| Delivery guarantee | JetStream at-least-once where streams exist; treasury subjects fall on the floor (EV-01) |
| Retries/backoff | Worker-level retry loops; no systematic backoff/DLQ |
| Dead-letter handling | **None anywhere** — poison messages can hot-loop consumers |
| Backpressure | NATS pending limits default; WS hub buffered chan 256/client |
| Consumer lag monitoring | Not instrumented (add Prometheus lag metrics — Phase 2) |
| Replay | JetStream retention enables manual replay; no tooling |
| Correlation/trace IDs | `X-Request-ID` in HTTP logs; events lack propagated trace IDs |
| Privacy | Events carry ids/amounts, not credentials — OK |
| NATS security | No auth in compose; ports now loopback-bound (fix) — enable creds for prod |

## 3. Real-Time Client Layer

- Explorer hub (public) works when WS can reach the API; wallet WS subscribes per-user topics on it.
- Authenticated hub `/v1/ws`: server behind RequireAuth; **frontend fetches a token then opens the socket without credentials** (FE-01) and same-origin WS can't traverse Next rewrites (FE-02). Net effect: authenticated realtime (notifications, session updates, presence) is dead in most deployments.

## 4. Findings

| ID | Title | Severity | Status |
|----|-------|----------|--------|
| EV-01 | Treasury subjects have no JetStream stream — silent drop | High | Open |
| EV-02 | `manifests.coordinated` produced, never consumed | Medium | Open |
| EV-03 | Redis billing consumer is log-only (false event-driven-billing signal) | Medium | Open |
| EV-04 | Declared Redis event types without producers | Low | Open |
| EV-05 | Redis SPOF for sessions/metering (also in `06`) | High | Open |
| EV-06 | No DLQ / poison-message handling anywhere | Medium | Open |
| EV-07 | No consumer-lag metrics | Medium | Open |
| EV-08 | No event schema validation/versioning | Low-Med | Open |
| FE-01/02 | Client WS auth/transport broken | High | Open |

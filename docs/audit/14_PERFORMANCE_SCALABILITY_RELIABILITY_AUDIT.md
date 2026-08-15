# 14 — Performance, Scalability & Reliability Audit

Method: static analysis + existing benches/load assets. No live load test was executed during this audit (environment not provisioned); all scale statements are architectural estimates, labeled as such.

## 1. Scale Envelope Assessment (architectural estimates)

| Concurrent proxy sessions | Expected behavior | First bottleneck |
|---------------------------|-------------------|------------------|
| 100 | Comfortable on one gateway pod + single Redis/PG | none |
| 1,000 | OK per gateway pod (yamux 256 ch/tunnel × pooling); watch FD limits | gateway FDs; Redis single-node CPU |
| 10,000 | Needs multiple gateway pods (multipod directory exists) + Redis HA + PG pool tuning (200 max conns set) | Redis SPOF; PG write I/O on receipts; NATS consumer throughput |
| 100,000 | Requires regional gateways, session sharding, telemetry warehouse, settlement batching | **OLTP writes (receipts/explorer), Redis, PG connections** — not attainable as-built |

## 2. Bottleneck Inventory

| Area | Issue | Severity |
|------|-------|----------|
| Gateway | rotation `Mutex` contention at high fan-out; no CONNECT failover retry | Medium |
| Gateway | admission semaphore OK; yamux channel cap 256/tunnel | Info |
| Metering | 30s flush batches OK; WAL durability windows (GW-08) | Medium-High |
| Control-api | GORM Preload loops possible on feed/orders (watch) | Low-Med |
| Postgres | marketplace filter seq scans without (status,country)/(status,isp)/latency indexes (DB-05) | Medium |
| Postgres | usage_receipts + explorer growth in OLTP; no rollups/warehouse (EV-06) | Medium (grows) |
| Redis | single-node SPOF for sessions + metering WAL + rate limits (EV-05) | High |
| NATS | no lag metrics; no DLQ; treasury subjects unstreamed | Medium |
| Solana RPC | public endpoints; settle fire-and-forget on usage path; no retry queue | Medium |
| Web frontend | fine (static + React Query caching) | Low |
| Logs/metrics | metrics cardinality: per-session labels on some gateway metrics could explode at scale — audit label sets before 10k | Medium |
| Blockchain calls | on-chain used only for money movement — appropriate; keep off-chain for metering | OK |

## 3. Reliability Review

| Aspect | Verdict |
|--------|---------|
| Graceful shutdown (control-api) | **Fixed this audit** (SIGTERM drain 30s); gateway has pod-drain |
| Health/readiness | present on all core services |
| Circuit breakers | present (gateway provider CB; control-api CB stats endpoint) |
| Retries | RPC failover helper; no settle retry queue; no event retry/backoff policy |
| Failure recovery | Redis loss = live sessions + unreported metering lost (EV-05); PG loss = full stop (acceptable); NATS loss = degraded async (soft-fail) |
| Single points of failure | Redis (High), oracle hot wallet key (High), single PG (acceptable w/ backups), NATS (Medium) |
| Backpressure | gateway admission semaphore; NATS default pending; WS per-client buffer 256 |
| Data corruption risks | ledger mutability (DB-03); WAL windows (GW-08); async P2P settle (BE-10) |

## 4. Load/Perf Assets In-Repo

| Asset | Target | Gap |
|-------|--------|-----|
| `testing/load_test.js` (custom, 100 conc / 5m) | Solana devnet RPC escrow flows | not product API |
| `testing/load_test.yml` (Artillery to 200rps) | Solana JSON-RPC | not product API |
| gateway Criterion benches (hotpath/registry/transport) | micro | no e2e CONNECT bench |
| `services/edge-gateway/scripts/` p0-p6 compose/load scripts | ops smoke | manual |
| **Missing** | k6/Artillery scenarios for control-api + full CONNECT path with SLO thresholds | OPS-08 |

## 5. Recommendations (priority order)

1. Redis HA (sentinel/cluster) + metering WAL fallback to PG before paid scale.
2. Add `(status,country)`, `(status,isp)` (+trigram), `avg_latency_ms` indexes; paginate secondary lists.
3. k6 suite: CONNECT path (auth+route+meter) with p95/p99 SLOs; control-api hot routes.
4. Settlement retry queue + RPC fallback RPCs (paid tier) for settlement path.
5. Metrics-label audit; NATS lag + DLQ; warehouse (ClickHouse) for receipts/explorer rollups at 10k+.
6. Regional gateway deployment + multipod directory hardening for 10k-100k roadmap.

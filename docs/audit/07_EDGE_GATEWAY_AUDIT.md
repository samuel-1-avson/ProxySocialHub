# 07 — Edge Gateway Audit

**Component:** `services/edge-gateway` — Rust/tokio, hyper HTTP, yamux reverse multiplexing, optional QUIC + OTEL features, Criterion benches.

## 1. Capability Verification

| Capability | Status | Evidence |
|------------|--------|----------|
| HTTPS CONNECT proxying | ✅ | `main.rs:731-1405` |
| HTTP forward proxy (absolute-URI) | ❌ 501 | `main.rs:1398-1405` (GW-01) |
| SOCKS5 (opt-in) | ✅ | `ingress/socks5.rs` (`ENABLE_SOCKS5`/`SOCKS5_PORT`); no UDP ASSOCIATE/BIND |
| SOCKS4 | ❌ | absent (GW-02) |
| WebSocket tunnel | ✅ | `proxy/websocket.rs` |
| Buyer auth (Basic→Redis session / session-intent JWT) | ✅ fail-closed | `auth.rs:252-296`, `auth/session_intent.rs:64-78` |
| Entitlement (purchase check at CONNECT) | ⚠️ | trusts pre-provisioned Redis session / JWT claims; no live control-api check (T7) |
| Destination policy (pre-DNS) | ✅ | `policy.rs:152-234`: port allowlist, private/reserved IP literals, hostname denylist (`localhost`, `.local`, metadata) |
| DNS resolution on gateway | ❌ by design | resolved on provider; rebinding defense = provider post-resolve check (GW-07) |
| Provider selection (sticky/geo/pin/score/ML/random) | ✅ | `provider_selection.rs:242-350` |
| ISP-targeted selection | ❌ | `target_isp` stored, never used (GW-04) |
| Reverse tunnels (provider dials out) | ✅ yamux TCP+TLS; QUIC feature | `tunnel.rs:138-215,256-343` |
| Failover to alternate provider | ❌ | single pick per CONNECT (GW-06) |
| Per-session concurrency/RPM enforcement | ❌ | JWT claims parsed, not enforced; process-wide governor only (GW-03) |
| Live bandwidth shaping | ❌ | shaper cap hardcoded 0 (GW-05) |
| Byte metering (up/down) | ✅ gateway-measured | `bridge_tracked`, `main.rs:1609-1687` |
| Usage reporting | ✅ batched+signed | Redis WAL → 30s flush → POST `/v1/gateway/usage/report` (Ed25519) (`metering.rs:53-94,201-261`) |
| Duplicate-charge prevention | ⚠️ | server-side UNIQUE(session,nonce); nonce = millis timestamp (GW-08) |
| Session-intent delta sync | ✅ | intents sync usage to control-api |
| Admission control | ✅ | semaphore; circuit breaker; DDoS module; honeytoken |
| Health/metrics | ✅ | `/health` `/ready` (8090), `/metrics` (9090) |
| Graceful drain | ✅ partial | pod drain via Redis; no in-flight guarantee |

## 2. Security Assessment

- **Open-proxy exposure:** binds 0.0.0.0 intentionally; anonymous CONNECT → 407. Safe **if** auth is healthy (Redis/JWT secret). Misconfig (empty JWT secret) = open proxy. Recommend network policy + auth-failure alerting (Prometheus rule exists).
- **SSRF / private networks:** gateway blocks literal private IPs + suspicious hostnames pre-DNS; **cannot** stop DNS-rebinding hostnames — that defense lives in provider-node post-resolve filtering (present, PN-01). Keep agent version-gating + leases to prevent stale agents (GW-07).
- **TLS:** provider tunnel TLS; buyer TLS terminates at client target via CONNECT (end-to-end preserved); cert validation on tunnel handshake.
- **Abuse:** destination port allowlist + domain denylist; spending enforcement is revalidation-based (post-hoc), not live-capped.

## 3. Metering Integrity (deep dive — GW-08)

Current flush loop drains the in-memory map **before** HTTP success; on failure the Redis WAL retains data but the runtime **does not reload WAL until restart** (comment claims "next cycle" — incorrect). Dedup key `(session_username, nonce)` with nonce = Unix millis:

- Two flushes in the same millisecond with identical counters → second rejected as duplicate (under-charge).
- Crash after successful charge but before WAL delete → replay with a **new** millis nonce → double-charge (window is small but real).
- **Required fix:** content-hash or monotonic report-id nonce; requeue WAL in-loop after failed flush; delete WAL only after durable ACK.

## 4. Reliability & Scale Notes

- Tokio spawn per accept/CONNECT/bridge; yamux channel cap 256; connection pool + prewarm; score snapshot refresh; rotation `Mutex` (contention risk at high fan-out).
- File-descriptor exhaustion is the first ceiling at ~10k concurrent sessions per pod; HPA exists for k8s (broken deploy path notwithstanding).
- Benches exist (`hotpath_bench`, `registry_bench`, `transport_bench`) but no automated CONNECT→provider→receipt e2e in this crate.

## 5. gRPC Contract

`proto/gateway.proto` defines `ControlPlane` (ValidateProviderToken, streaming ReportUsage) — **unused**; live path is HTTP REST + JWT (GW-09). Deprecate or implement.

## 6. Sequence Diagram (as-built, post-fix)

```mermaid
sequenceDiagram
    participant C as Buyer Client
    participant G as Edge Gateway
    participant R as Redis
    participant P as Provider Agent
    participant D as Destination
    participant A as control-api

    C->>G: CONNECT host:443 (Proxy-Authorization)
    G->>R: session lookup / JWT verify
    R-->>G: session {limits, node_id}
    G->>G: policy check (port/IP/hostname)
    G->>G: select provider (sticky/geo/pin/score)
    G->>P: yamux stream: "CONNECT host:443"
    P->>P: resolve DNS; reject non-public IP
    P->>D: TCP connect
    P-->>G: "OK"
    G-->>C: 200 Connection established
    C->>D: TLS end-to-end via tunnel
    G->>R: WAL += bytes (bridge_tracked)
    loop every 30s
        G->>A: POST /v1/gateway/usage/report (Ed25519 sig)
        A->>A: VerifySignature (FAIL-CLOSED)
        A->>A: usage_receipts upsert + pending ledger
        A-->>G: 200 ACK
        G->>R: delete WAL entries (post-ACK)
    end
```

**Can this flow complete in production?** Yes for CONNECT, with the caveats: failover absent, limits unenforced live, WAL/nonce idempotency gaps (GW-03/05/06/08).

## 7. Findings

| ID | Title | Severity | Status |
|----|-------|----------|--------|
| GW-01 | HTTP forward proxy missing (501) | Medium | Open |
| GW-02 | SOCKS4 absent; SOCKS5 opt-in only | Low | Open |
| GW-03 | Session-intent max_concurrency/RPM not enforced | Medium | Open |
| GW-04 | `target_isp` never used in routing | Medium | Open |
| GW-05 | Bandwidth shaper cap hardcoded 0 | Medium | Open |
| GW-06 | No retry to alternate provider on bridge failure | Medium | Open |
| GW-07 | DNS-rebinding defense depends entirely on provider agent | High (conditional) | Open (mitigations documented) |
| GW-08 | Metering WAL flush/nonce durability → under/over-charge | Medium-High | Open |
| GW-09 | gateway.proto unused (dual contract) | Low | Open |
| GW-10 | 0.0.0.0 bind; open-proxy if auth misconfigured | Low | Open (ops guardrails) |
| GW-11 | CONNECT returns empty 200 after spawn | Info | — |

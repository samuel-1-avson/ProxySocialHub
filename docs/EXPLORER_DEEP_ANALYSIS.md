# ProxyHubb Explorer — Deep Analysis & Issue Report

> Status: **Analysis for review** (no code changed). An implementation plan will follow after sign-off.
> Date: 2026-06-01
> Scope: the public block/network explorer — frontend pages, the map subsystem, the Go `control-api` explorer endpoints, the explorer WebSocket, models, and the geo/marketplace pin feed.

---

## 1. Executive Summary

The Explorer is feature-rich (dashboard, transactions, blocks, nodes, validators, wallets, contracts, analytics, leaderboard, sessions, earnings, health, decentralization trust, 2D + 3D maps) but carries significant risk in four areas:

1. **Data integrity / "fake-real" data** — several headline numbers are stubbed, mislabeled, or fabricated client-side (e.g., analytics time series are never written, `avg_response_time_ms` is always 0, leaderboard silently falls back to a locally-sorted node list, bandwidth "24h" is actually lifetime totals).
2. **Privacy & security** — public, unauthenticated endpoints expose `linked_user_id` (wallet → platform UUID), provider identities, internal RPC endpoints, validator hotkeys, raw transaction payloads, and full session/earnings data. Rate limiting silently disables when Redis is absent; the WebSocket has no auth, no rate limit, and bypasses the decentralization gate.
3. **A blocking logic bug** — the "full decentralization" gate requires `MinWritersRequired >= 3` while the configured default is `2`, so in full mode the public explorer can be **permanently stuck returning 503**.
4. **Performance & maintainability** — aggressive polling stacked on top of WebSocket updates, N+1 queries, `COUNT(*)`/`OR` scans, per-request Solana RPC calls, a 3D globe that draws an arc per node + up to ~7k labels, ~35 unused "Phase 1–6" map files and 5 unrouted demos, and three separate globe implementations.

### Top 10 issues (by priority)

| # | Severity | Issue | Where |
|---|----------|-------|-------|
| 1 | Critical | Full-decentralization gate can never open (`>=3` vs default `2`) → permanent 503 in full mode | `explorer.go:1804,1838` |
| 2 | Critical | Analytics/health-history time series are never populated (`explorer_metrics` has no writer) → empty/frozen charts | `explorer.go` analytics/health paths |
| 3 | High | `linked_user_id` exposed publicly (wallet → platform user UUID) | `explorer.go:781–797` |
| 4 | High | WebSocket: no auth, no rate limit, not gated, drops messages silently | `explorer_ws.go`, `main.go:420` |
| 5 | High | Leaderboard/analytics fabricate rankings from page-1 nodes on empty-success | `leaderboard/page.tsx:85–98`, `analytics/page.tsx:191–204` |
| 6 | High | Mislabeled/stub metrics: `avg_response_time_ms`=0, `average_throughput_mbps`=0, "24h" bandwidth = lifetime, TPS = 24h average | `explorer.go` health/bandwidth/metrics |
| 7 | High | Orphaned (re-org) transactions/blocks still shown in lists & stats | `explorer.go` list/stats endpoints |
| 8 | High | Rate limiting silently skipped when Redis is nil | `ratelimiter/advanced.go:120–123` |
| 9 | High | Server-paginated nodes filtered/sorted client-side → incorrect results | `nodes/page.tsx:84–95` |
| 10 | High | Broken explorer navigation: Overview tab always "active"; dashboard node search dead; block hashes misrouted | `layout.tsx:57`, `page.tsx:239–246` |

---

## 2. Architecture Overview

```
Browser (Next.js App Router /explorer/*)
   │  react-query polling + WebSocket (useExplorerWS)
   ▼
control-api /v1/explorer/*  (public, optional auth, IP rate limit, full-mode gate)
   │
   ├── Postgres: explorer_transactions, explorer_blocks, explorer_nodes,
   │             explorer_contracts, explorer_block_attestations,
   │             explorer_metrics(*never written*), sessions, provider_earnings, profiles
   ├── Solana RPC (live, per-request for wallet balance / tx fallback)
   ├── BlockchainIndexer (poll ~400ms) → txs/blocks/attestations
   └── NodeSync (poll ~60s) + GeoIP → explorer_nodes
```

Data sources at a glance:

| Entity | Source | Freshness |
|--------|--------|-----------|
| Blocks / txs | Solana RPC via BlockchainIndexer | ~400ms poll |
| Attestations / writers | Indexer per writer | ~400ms |
| Nodes / geo | `nodes` table via NodeSync + GeoIP | ~60s; inactive after 30 min |
| Wallet balance | **Live Solana RPC on read** | per request |
| Sessions / earnings | Platform DB | live |
| Analytics / health history | `explorer_metrics` table | **no writer found** |

---

## 3. Severity Legend

- **Critical** — broken core behavior, data integrity failure, or privacy/security exposure that should block release.
- **High** — significant correctness, security, or performance problem; fix soon.
- **Medium** — meaningful defect or risk; schedule.
- **Low** — polish, hygiene, minor UX.

---

## 4. Backend (`control-api`) Findings

### 4.1 Correctness / Data Integrity

| Severity | Location | Finding |
|----------|----------|---------|
| Critical | `explorer.go:1804` vs `:1838` | `explorerMinWritersRequired()` defaults to **2**, but `isExplorerFullyDecentralized()` hard-requires `MinWritersRequired >= 3`. In `FULL_DECENTRALIZATION=true` mode the gate evaluates `FullyDecentralized=false` forever → explorer returns **503** indefinitely unless `EXPLORER_MIN_WRITERS>=3`. |
| Critical | analytics/health paths | `explorer_metrics` is **never written** anywhere in the codebase. `/analytics`, `/health/history`, and earnings `volume_chart` read it, so charts are **empty/frozen** unless an external job exists. |
| High | `explorer.go` (`getNetworkHealth`) | `avg_response_time_ms` is **never assigned** → always `0`. The dashboard "Response Latency" and health page always read 0 ms. |
| High | `explorer.go` (bandwidth) | `average_throughput_mbps` never set → always `0`; `last_24_hours_bandwidth` actually **sums lifetime `total_bandwidth`** for recently-seen nodes (mislabeled). |
| High | list/stats endpoints | Transaction/block lists and `getNetworkStats` do **not filter `is_orphaned`**, while the metrics path does. Re-org/orphan rows appear as valid chain history → inconsistent views. |
| Medium | `explorer.go` (metrics) | `transactions_per_second` = `count(last 24h)/86400` (a 24h **average**, not instantaneous TPS) — mislabeled. |
| Medium | `explorer.go` (metrics) | Avg block time computed over last 1000 blocks with **no chain / orphan filter**; `active_wallets` = `COUNT(wallets)` (all platform wallets, not on-chain-active). |
| Medium | `explorer.go` (block detail) | Block detail loads txs with `Limit(100)` but reports full `transaction_count` → silent truncation. |
| Medium | node sync | `is_validator = quality_score > 90` heuristic (not the Solana validator set); `stake_amount`/`commission_rate` never set, yet validators are sorted by `stake_amount DESC` (all zeros). |
| Medium | `explorer.go` (leaderboard) | `quality_score` computed ad-hoc; the `period` query param is ignored. |
| Medium | `explorer.go` (wallet) | `first_activity`/`last_activity` come from `First()`; with no rows they return the **zero time** (epoch) instead of null. |
| Medium | `marketplace_geo.go:213` | Missing lat/lon are replaced with deterministic jittered centroids → **fake coordinates** presented as node/listing locations. |
| Low | `explorer_ws.go` poller | First poll with zero `lastTxTime` re-broadcasts recent txs as "new"; equal-timestamp txs can be skipped. |
| Medium | `explorer.go` (metrics) | `chain` query param is accepted but live queries hardcode `"solana"` → multi-chain contract is misleading. |

### 4.2 Performance / Scalability

| Severity | Location | Finding |
|----------|----------|---------|
| High | `explorer.go` (`getExplorerMetrics`) | On cache miss, a single `/metrics` request fires **8+ separate aggregate queries** (`COUNT`, `SUM`, `GROUP BY`, `Limit(1000)`). |
| High | `explorer.go` (decentralization) | Status/writers run multiple `COUNT(DISTINCT …)` + nested raw SQL over `explorer_block_attestations` (window up to 4096 slots); writers endpoint uncached. |
| High | `explorer.go` (tx queries) | `WHERE from_address = ? OR to_address = ?` for counts/lists defeats composite indexes → sequential scans as the table grows. |
| Medium | `explorer.go` (earnings) | N+1 `users` lookup inside the provider-earnings loop (partially cached 2 min). |
| Medium | `explorer.go` (wallet/tx) | Per-request **Solana RPC** (`GetBalance`, `GetTokenBalance`, tx fallback) on public endpoints → RPC amplification / abuse vector. |
| Medium | `marketplace_geo.go:113–216` | Heavy multi-LATERAL JOIN, `LIMIT 5000`, and bbox filtering done in Go **after** fetch (not in SQL). |
| Medium | `explorer.go` (`/nodes/geo`) | Returns up to 5000 nodes; `total` = `len(points)` not the DB total → clients can't tell data was truncated. |
| Low | `explorer.go` (analytics) | Custom `from`/`to` range with `bucketCount=0` → no LIMIT → unbounded time series. |
| Low | `explorer_ws.go:254–315` | Shared poller hits DB every 5s regardless of subscriber count. |

**Implied missing indexes:** composite `(chain, is_orphaned, timestamp)` and `(from_address, timestamp)` / `(to_address, timestamp)` for the dominant filters.

### 4.3 Security / Privacy

| Severity | Location | Finding |
|----------|----------|---------|
| High | `explorer.go:781–797` | `/wallets/:address` returns `linked_user_id` (platform UUID) for any address → **deanonymization** of users from on-chain addresses. |
| High | `explorer.go` (`/decentralization/writers`) | Exposes per-writer `rpc_endpoint` → leaks internal/indexer infra URLs. |
| High | `main.go:401–420` | All explorer routes mounted on public `/v1` with **optional** auth only — full read access to txs, blocks, nodes, sessions, earnings, wallet linkage. |
| High | `ratelimiter/advanced.go:120–123` | When Redis is `nil`, rate limiting is **skipped entirely** → DoS / scraping / RPC-abuse exposure. |
| Medium | `explorer.go` (sessions/earnings) | Public `/sessions` (IDs, bytes, status, times) and `/earnings` (provider wallet + SOL earned) leak operational and financial intelligence. |
| Medium | `explorer.go` (nodes) | Public nodes expose `provider_id` and `provider_username` → provider enumeration. |
| Medium | `explorer.go` (errors) | 500 responses include `"details": err.Error()` → can leak SQL/ORM internals. |
| Medium | `transactions/[hash]` | API returns `raw_data` rendered verbatim in the UI → potential internal/PII leakage. |
| Low | `explorer_ws.go:20–31` | If `APP_URL` is unset, **all WS origins are allowed** (CSRF-like in a misconfigured prod). |

> Note: SQL is parameterized (GORM / bound `$N`); no string-concatenated injection found.

### 4.4 WebSocket (`explorer_ws.go`)

| Severity | Location | Finding |
|----------|----------|---------|
| High | `main.go:420` | WS registered **outside** the full-decentralization gate → live feed serves data while HTTP returns 503. |
| High | `explorer_ws.go:337–357` | No auth on upgrade, **no rate limit, no connection cap** → connection exhaustion / amplification. |
| Medium | `explorer_ws.go:106,287–328` | `broadcast` buffer of 256 with `default:` drop → **silent message loss** under load, no backpressure. |
| Medium | `explorer_ws.go:375–381` | Per-connection nested ping goroutine stopped only on write failure → minor goroutine leak. |
| Medium | `explorer_ws.go:42–46` | Redundant `clients` vs `entries` maps (broadcast uses `entries`) → confusing lifecycle. |

### 4.5 Decentralization Gate

The status/writers computation is **real** (DB attestations, `COUNT(DISTINCT writer)`, conflict CTE, Ed25519 identity verification) with sensible degraded modes (`legacy_no_attestation_schema`, `bootstrap_no_attestations`). The defects are: the **threshold contradiction** (4.1 Critical #1), the gate failing the entire explorer on a transient DB error (→503), the 5s **in-process-only** cache (instances disagree after deploy), and the **WS bypass** (4.4).

---

## 5. Frontend Findings (pages, excluding map)

### 5.1 Data Integrity / "Fake-Real" Data

| Severity | Location | Finding |
|----------|----------|---------|
| High | `leaderboard/page.tsx:85–98`, `analytics/page.tsx:191–204` | When the leaderboard API returns **empty but successful**, the page silently falls back to a locally-sorted `getNodes()` list and presents it as the official ranking (warning shown only on error). |

### 5.2 Data Fetching

| Severity | Location | Finding |
|----------|----------|---------|
| High | `page.tsx:94–186` | Dashboard runs 7+ `useQuery` hooks with aggressive intervals (tx/blocks 5s, metrics 10s, decentralization 20s ×2, health 30s, nodes 60s, analytics 120s) — multiplied per open tab. |
| High | `page.tsx:188–224` + `useExplorerWS.ts` | Dashboard **polls and** WebSocket-subscribes the same domains (txs, blocks) → duplicate traffic and state drift. |
| Medium | all pages except `health/page.tsx` | `xfetch` supports `AbortSignal` but only health passes `({ signal })`; others don't cancel in-flight requests on unmount/navigation. |
| Medium | `contracts/page.tsx:22–27` | Contracts list uses inline `fetch()` instead of the `explorer.ts` service → no abort, no shared error handling. |
| Low | detail pages | `useQuery` without `enabled: !!param` can fire requests for empty route params. |

### 5.3 Error / Empty / Loading States

| Severity | Location | Finding |
|----------|----------|---------|
| High | `transactions/[hash]`, `wallets/[address]`, `contracts/[address]` (`:52–58`) | Any failure (network/500) renders generic **"Not Found"** → masks outages, misleads users. |
| Medium | `health/page.tsx:74–120` | `loadingHealth` unused; subsystem cards show `'unknown'` during load, resembling real degraded state. |
| Medium | `blocks/page.tsx:146–147` | Shows "Page 1 of 0" on empty/error. |
| Medium | `search/page.tsx:96–98` | `hasError` ignores per-query `isError` and pending races → false "Not Found". |
| Low | `wallets/[address]/page.tsx:241` | Next-page enabled on a full page with no `total` → empty trailing page. |

### 5.4 UX / Navigation / Correctness

| Severity | Location | Finding |
|----------|----------|---------|
| High | `layout.tsx:57` | Overview tab href is `/explorer`, and active check uses `startsWith` → **every** sub-route marks Overview active. |
| High | `page.tsx:239–246` | Dashboard search routes unknown queries to `/explorer/nodes?q=…`, but `nodes/page.tsx` never reads `q` → node search silently fails. |
| High | `page.tsx:239–244`, `search/page.tsx:35–40` | Search type detection misroutes Solana **block hashes** (base58 ≥64) as transactions and **contract** addresses as wallets. |
| High | `nodes/page.tsx:84–95` | Validator/proxy filter + sort apply **only to the current API page** while `total` is unchanged → incomplete/incorrect results. |
| Medium | `blocks/page.tsx:108–136` | Block rows are not linked to `/explorer/blocks/[number]` (detail page exists but is undiscoverable). |
| Medium | `nodes/page.tsx:184–210` | "Full Leaderboard →" links to `/explorer/analytics` instead of `/explorer/leaderboard`. |
| Medium | `nodes/compare/page.tsx:25` vs `nodes/[id]/page.tsx:175` | `success_rate` shown `×100` in compare but raw in detail → inconsistent scale. |
| Medium | `layout.tsx:14–24` | Tab bar omits Blocks and Contracts (only reachable via dashboard/search) → inconsistent IA; triple nav on mobile. |

### 5.5 Frontend Performance / Maintainability

| Severity | Location | Finding |
|----------|----------|---------|
| Medium | analytics/leaderboard/earnings/health/`page.tsx` | Large Recharts trees without `React.memo`/stable refs, animated with framer-motion stagger, re-render on each poll tick. |
| Medium | all list pages | Tables of 50–100 rows with no virtualization. |
| Medium | tx/sessions/earnings | Near-duplicate `downloadCsv()` helpers in three files. |
| Low | `search/page.tsx:8`, `leaderboard/page.tsx:113`, `explorer.ts:1` | Dead imports / unused vars (`getNodes`, `rest`, `fetchWithAuth`). |

---

## 6. Map Subsystem Findings (`explorer/map/**`)

**Production surface is only 3 files:** `page.tsx`, `GlobeMap.tsx` (3D), `LeafletMap.tsx` (2D). Everything else is an unintegrated "Phase 1–6" library + demos.

### 6.1 Dead / Demo Code

| Severity | Location | Finding |
|----------|----------|---------|
| Medium | `map/examples/{Filter,Effects,Theme,Panel,Final}Demo.tsx` | 5 demo files, **not imported, not routed**. Scripts/docs (`start-map-enhanced.bat`, `docker-update-simple.ps1`, `README.md`, `INTEGRATION_GUIDE.md`) advertise routes that 404. |
| Medium | `map/globe/`, `accessibility/`, `components/`, `controls/`, `effects/`, `filters/`, `loading/`, `panel/`, `stats/`, `styles/`, `transitions/`, `utils/`, map-local `error/` | ~35 files unreferenced by the production page (dead weight, onboarding hazard). |
| Medium | three globe implementations | `GlobeMap.tsx` (prod), `globe/GlobeViewSimple.tsx` (dead), `globe/GlobeView.tsx` (dead, full R3F/three) — bug fixes would need to land in multiple places. |
| Low | `LeafletMap.tsx:7`, `package.json` | Misleading comment ("react-leaflet") while using imperative `leaflet`; `react-leaflet` dependency unused. |

### 6.2 Performance / Memory

| Severity | Location | Finding |
|----------|----------|---------|
| High | `GlobeMap.tsx:594–609` | Globe pointer listeners added in `initControls`; effect re-runs on resize with only `clearTimeout` → **duplicate listeners accumulate**. |
| High | `GlobeMap.tsx:639–651` | One animated arc per active node to a fixed "Nexus" → hundreds of GPU-animated arcs at scale. |
| High | `GlobeMap.tsx:527–541,675–685` | Replaces static cities with up to **~7k** Natural Earth labels → text/WebGL cost scales with dataset, not node count. |
| High | `page.tsx:196–207` | WS `node_update` calls `setLiveUpdates` per event → re-render storm; both maps re-run effects. |
| Medium | `GlobeMap.tsx:520–543` | CDN GeoJSON/texture fetches with no `AbortController` → setState-after-unmount, offline failure. |
| Medium | no dispose | No three.js/WebGL dispose on unmount when toggling 2D↔3D. |

### 6.3 Correctness / A11y

| Severity | Location | Finding |
|----------|----------|---------|
| High | `page.tsx:56–125` | `resolveCoords` replaces missing lat/lon with country/region centroids → nodes stack at centers; "Plotted" count overstates precision. |
| High | `page.tsx` (no `aria-`/`role`) | Production map page has **no ARIA**, color-only status dots, map not keyboard-operable (the rich `accessibility/ARIA.tsx` exists but is unused). |
| Medium | `page.tsx:147,209–211` | `wsConnected` set true on initial only, never cleared on close/error → stale "WS Connected". |
| Medium | `page.tsx:143,588–610` | `mapStyle` controls only affect the 3D globe, but the sidebar shows them in 2D mode too → no-op controls. |

---

## 7. Dead Code Inventory (safe-to-remove or integrate)

- `apps/web/src/app/explorer/map/examples/*` (5 demo files)
- `apps/web/src/app/explorer/map/globe/*` (`GlobeView.tsx`, `GlobeViewSimple.tsx`, `index.ts`)
- `apps/web/src/app/explorer/map/{accessibility,components,controls,effects,filters,loading,panel,stats,styles,transitions,utils}/*`
- map-local `error/ErrorBoundary.tsx`
- `map/README.md`, `map/INTEGRATION_GUIDE.md` (describe a non-shipped architecture)
- Unused deps to reassess after cleanup: `react-leaflet`, and `@react-three/fiber`/`@react-three/drei`/`three` (only used by dead `GlobeView.tsx`)
- Dead imports: `getNodes` (`search/page.tsx`), `fetchWithAuth` (`explorer.ts`), `rest` (`leaderboard/page.tsx`)

---

## 8. Recommended Remediation Roadmap (for the follow-up plan)

> This is a proposed ordering only; the detailed implementation plan will be produced after you review this report.

**Phase 0 — Correctness & security blockers (Critical/High)**
1. Fix the decentralization gate threshold contradiction (align `isExplorerFullyDecentralized` with `EXPLORER_MIN_WRITERS`, or document/require ≥3 and make the constant configurable).
2. Either implement an `explorer_metrics` aggregation worker or disable/relabel analytics & health-history until backed by real data.
3. Stop exposing `linked_user_id`, provider identity, `rpc_endpoint`, validator hotkeys, raw tx payloads, and full sessions/earnings on public routes (gate behind auth or redact).
4. Add auth + rate limit + connection cap + the decentralization gate to the WebSocket.
5. Replace the "Redis nil → no rate limit" path with an in-memory fallback limiter.
6. Filter `is_orphaned = false` on all tx/block list and stats endpoints.
7. Remove `details: err.Error()` from public 500s.

**Phase 1 — Honest metrics & frontend trust**
8. Fix or relabel `avg_response_time_ms`, `average_throughput_mbps`, "24h" bandwidth, TPS semantics, `active_wallets`, validator stake/commission.
9. Remove the leaderboard/analytics silent fallback to locally-sorted nodes (show a real empty state).
10. Distinguish 404 vs error on detail pages; fix "Page 1 of 0".

**Phase 2 — UX & navigation**
11. Fix `layout.tsx` active-tab logic; add Blocks/Contracts tabs; link block rows.
12. Implement node search `?q=` (or fix dashboard routing); fix search type detection for block hashes/contracts.
13. Move node filtering/sorting server-side (or fetch full set) so results are correct.
14. Normalize `success_rate` scale across pages.

**Phase 3 — Performance**
15. Consolidate dashboard polling with the WebSocket (single source of truth); reduce intervals.
16. Add composite indexes; cache decentralization/writers; avoid per-request Solana RPC (cache wallet balances).
17. Globe: fix listener leak, cap/curate arcs and labels, batch WS updates, add dispose; pass `AbortSignal` in queries.

**Phase 4 — Hygiene**
18. Delete or integrate the dead map library + demos; fix/remove broken script/doc URLs; drop unused deps; extract shared `ExplorerTable`/`Pagination`/`downloadCsv`.

---

## 9. Positive Notes

- Consistent React Query usage (one exception), loading skeletons, and basic error banners on most pages.
- WebSocket hook has exponential backoff + jitter and proper cleanup.
- Map libraries are correctly code-split via `next/dynamic` (`ssr:false`); 2D map uses supercluster clustering and tears down listeners/map correctly.
- Decentralization status/writers use real cryptographic attestation verification.
- SQL is parameterized; no injection found.

---

## 10. Evidence Index (key file:line references)

- Routes & gate: `services/control-api/internal/api/explorer.go:32–85`, `:423–458`
- Gate threshold bug: `explorer.go:1803–1817`, `:1836–1842`
- `linked_user_id` exposure: `explorer.go:781–797`
- WebSocket: `services/control-api/internal/api/explorer_ws.go:20–31,106,254–357,375–381`; `main.go:401–420`
- Geo/fake coords: `services/control-api/internal/api/marketplace_geo.go:113–216`
- Rate-limit skip: `internal/ratelimiter/advanced.go:120–123`
- Dashboard polling/WS: `apps/web/src/app/explorer/page.tsx:86–225,239–246`
- Service layer: `apps/web/src/lib/services/explorer.ts:170–177`
- Leaderboard fallback: `apps/web/src/app/explorer/leaderboard/page.tsx:85–98`; `analytics/page.tsx:191–204`
- Layout nav: `apps/web/src/app/explorer/layout.tsx:14–24,57`
- Map: `apps/web/src/app/explorer/map/page.tsx:56–125,143,147,196–211`; `GlobeMap.tsx:520–543,594–609,639–685`

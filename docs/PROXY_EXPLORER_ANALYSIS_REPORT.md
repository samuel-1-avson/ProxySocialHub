# Proxy Explorer - Full Analysis Report

**Date:** 2026-03-17
**Scope:** `apps/web/src/app/explorer/`, `apps/web/src/lib/services/explorer.ts`, `apps/web/src/lib/hooks/useExplorerWS.ts`, `services/control-api/internal/api/explorer.go`, `services/control-api/internal/api/explorer_ws.go`, `services/control-api/internal/models/explorer.go`

---

## Executive Summary

The ProxyHub explorer is a 12-page network analytics frontend backed by a Go REST API and WebSocket streaming server. The architecture is generally solid (React Query for data fetching, Recharts for visualisation, Leaflet for the node map) but has a significant number of **broken routes**, **hardcoded values**, **silent error swallowing**, and **missing features** that need to be addressed before it can be considered production-ready.

**5 routes currently return 404.** Several pages contain calculation bugs that produce incorrect data for end users. Error states are largely absent across all pages.

---

## 1. Page Inventory

### 1.1 Overview / Dashboard (`/explorer`)

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Main entry point: real-time stats, live tx/block streams, top nodes |
| **Data Sources** | `getExplorerMetrics`, `getRecentTransactions`, `getBlocks`, `getNetworkHealth`, `getNodes`, `getAnalytics`, WebSocket |
| **Polling** | Metrics: 10s / Transactions: 5s / Blocks: 5s / Health: 30s / Nodes: 60s / Analytics: 120s |
| **Status** | Functional with bugs |

**Bugs:**
- `"99.9%"` consensus rate is **hardcoded** -- not read from any API field
- WebSocket `new_transaction` events use `new Date().toISOString()` as timestamp instead of the server-provided value
- WebSocket `new_transaction` events hardcode `status: "confirmed"` regardless of actual tx status
- `metrics.avg_block_time_ms` accessed without null check -- crash if API omits the field
- No error UI rendered if any of the 6 API calls fail

---

### 1.2 Nodes List (`/explorer/nodes`)

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Paginated, filterable table of all proxy nodes |
| **Data Source** | `getNodes(page, 20, activeOnly)` -- refetch every 30s |
| **Status** | Functional with minor bugs |

**Bugs:**
- String sort comparator `bv.localeCompare(av)` crashes if `bv` or `av` is `null` -- no null guard
- `minutesAgo` heartbeat calculation has no try-catch for invalid ISO date strings
- `/explorer/nodes/[id]` detail page **does not exist** -- clicking a node produces a 404

---

### 1.3 Transactions (`/explorer/transactions`)

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Paginated transaction history with type/status filtering |
| **Data Source** | `getRecentTransactions(page, 20, chainFilter)` -- refetch every 10s |
| **Status** | Functional with UX limitations |

**Bugs / Limitations:**
- Type and status filters operate on the **current page only** -- no server-side filter params are sent
- Search input validates address format but does not actually filter results
- No data export capability

---

### 1.4 Wallets (`/explorer/wallets` and `/explorer/wallets/[address]`)

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Solana wallet lookup -- balance, activity, linked user |
| **Status** | **BROKEN -- detail page missing** |

**Critical Issues:**
- `/explorer/wallets/[address]/page.tsx` does not exist in the repository
- The entry page shows a search box but navigating to an address produces a 404
- `getWalletDetails(address)` and `getWalletTransactions()` are fully implemented in the service layer but never called

---

### 1.5 Blocks (`/explorer/blocks` and `/explorer/blocks/[number]`)

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Paginated block list with detail view |
| **Data Source** | `getBlocks(page, 20)` -- refetch every 10s |
| **Status** | List functional; **detail page missing** |

**Critical Issues:**
- `/explorer/blocks/[number]/page.tsx` does not exist
- Clicking any block navigates to a 404
- `getBlockDetail(blockId)` exists in the service layer but is unused

---

### 1.6 Analytics (`/explorer/analytics`)

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Historical charts: TPS, volume, bandwidth, region distribution, leaderboard |
| **Data Sources** | `getExplorerMetrics`, `getNodes`, `getAnalytics(period)`, `getLeaderboard(category, period)` |
| **Status** | Functional with silent failure |

**Bugs:**
- If `getLeaderboard` fails, silently falls back to client-sorted nodes -- no warning to user
- `metrics?.region_distribution` may be `undefined`, resulting in an empty pie chart with no feedback
- Chart mount guarded by `!mounted` -- risks Next.js hydration mismatch

---

### 1.7 Leaderboard (`/explorer/leaderboard`)

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Podium + ranked table of top provider nodes |
| **Data Sources** | `getLeaderboard(category, period)` with fallback to `getNodes(1, 100, true)` |
| **Status** | Functional with silent failure |

**Bugs:**
- Same silent fallback as analytics -- API failure shows locally sorted data without any warning
- Rank assignment does not account for ties -- identical scores get sequential ranks
- Category switch resets pagination but not scroll position

---

### 1.8 Node Map (`/explorer/map`)

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Interactive Leaflet map with geographic node clustering |
| **Data Source** | `getNodes(1, 200, false)` -- refetch every 30s |
| **Status** | Mostly functional; heatmap feature broken |

**Bugs:**
- **Heatmap toggle is non-functional** -- `showHeatmap` state is toggled by the UI button but never passed to the `LeafletMap` component; the feature does nothing
- All 200 nodes are downloaded and filtered client-side -- no server-side geo filtering
- Nodes missing `country_code` are silently excluded and only counted in a warning banner
- Error recovery button calls `window.location.reload()` -- crude, discards all page state

---

### 1.9 Sessions (`/explorer/sessions`)

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Live proxy session tracking |
| **Data Source** | `getExplorerSessions(page, 20, statusFilter, typeFilter)` -- refetch every 15s |
| **Status** | Functional with calculation bug |

**Bugs:**
- **Duration calculation wrong for active sessions:** uses `new Date()` as end time, so duration inflates with every page render instead of using a stable server-provided value
- `formatBytes()` has no guard for negative values or `NaN` input

---

### 1.10 Earnings (`/explorer/earnings`)

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Provider payout history and earnings breakdown |
| **Data Source** | `getProviderEarnings(period, page, 20)` -- refetch every 30s |
| **Status** | Functional |

**Minor Issues:**
- Rank counter `(page - 1) * 20 + i + 1` does not reflect actual server-assigned rank
- Date formatting silently returns raw ISO timestamp if `formatDistanceToNow` throws

---

### 1.11 Health (`/explorer/health`)

| Attribute | Detail |
|-----------|--------|
| **Purpose** | System health monitoring, uptime, subsystem status, incident log |
| **Data Sources** | `getNetworkHealth()` (15s), `getHealthHistory('24h')` (60s), `getExplorerMetrics('all')` (30s) |
| **Status** | Functional |

**Minor Issues:**
- Response time thresholds hardcoded (`<200ms` = healthy, `<500ms` = degraded) -- not configurable from API
- Health event log almost always empty (`historyData?.events` rarely populated by backend)

---

### 1.12 Search (`/explorer/search`) -- PAGE MISSING

- Listed in sidebar navigation
- **No file exists** in the repository -- produces Next.js 404

---

### 1.13 Contracts (`/explorer/contracts`) -- PAGE MISSING

- Listed in sidebar navigation
- **No file exists** in the repository
- Backend endpoints and service layer functions are fully implemented but never surfaced in UI

---

## 2. Frontend Service Layer (`lib/services/explorer.ts`)

### Function Usage Map

| Function | Used By | Notes |
|----------|---------|-------|
| `getExplorerMetrics(chain)` | Dashboard, Analytics, Health | Active |
| `getAnalytics(period)` | Analytics | Active |
| `getNetworkStats()` | Unused | Overlaps with `getExplorerMetrics` |
| `getHealthHistory(period)` | Health | Active |
| `getNetworkHealth()` | Dashboard, Health | Active |
| `getRecentTransactions(page, size, chain?)` | Dashboard, Transactions | Active |
| `getTransactionDetails(hash)` | Unused | No detail page exists |
| `getBlocks(page, size, chain?)` | Dashboard, Blocks | Active |
| `getBlockDetail(blockId)` | Unused | No detail page exists |
| `getNodes(page, size, activeOnly)` | Dashboard, Nodes, Analytics, Leaderboard, Map | Active |
| `getNodeDetail(nodeId)` | Unused | No detail page exists |
| `getValidators(page, size)` | Unused | -- |
| `getLeaderboard(category, period)` | Analytics, Leaderboard | Active |
| `getExplorerSessions(page, size, status?, type?)` | Sessions | Active |
| `getProviderEarnings(period, page, size)` | Earnings | Active |
| `getBandwidthStats(period)` | Unused | -- |
| `getWalletDetails(address)` | Unused | No detail page exists |
| `getWalletTransactions(address, page, size)` | Unused | No detail page exists |
| `getContractDetails(address)` | Unused | No contracts page exists |

**Issues:**
- `getNetworkStats()` and `getExplorerMetrics()` appear to return overlapping data -- one should be removed or differentiated
- No runtime shape validation on API responses -- components crash if backend changes field names
- All errors are generic `Error` instances with no typed error codes
- Query params built with manual string interpolation -- fragile with special characters

---

## 3. WebSocket Integration (`lib/hooks/useExplorerWS.ts`)

**Connection:** `ws[s]://hostname/v1/explorer/ws`
**Auto-reconnect:** 5s delay on disconnect
**Events:** `initial`, `new_transaction`, `new_block`, `node_update`

| Issue | Impact |
|-------|--------|
| Consuming pages override server timestamp with `new Date()` | Transactions show wrong time in live feed |
| Silent exception handler -- no logging on parse failure | Blind to WebSocket message errors |
| Memory leak if component unmounts during 5s reconnect timeout | Minor, intermittent |
| No message type filtering -- all clients receive all updates | Scales poorly |
| `update.data` shape assumed without validation | Crashes on unexpected backend schema change |

---

## 4. Backend REST API (`services/control-api/internal/api/explorer.go`)

### All Implemented Endpoints

```
GET /v1/explorer/metrics?chain=all
GET /v1/explorer/stats
GET /v1/explorer/analytics?period=24h
GET /v1/explorer/network/health
GET /v1/explorer/health/history?period=24h
GET /v1/explorer/transactions
GET /v1/explorer/transactions/:hash
GET /v1/explorer/blocks
GET /v1/explorer/blocks/:identifier
GET /v1/explorer/nodes
GET /v1/explorer/nodes/:id
GET /v1/explorer/validators
GET /v1/explorer/wallets/:address
GET /v1/explorer/wallets/:address/transactions
GET /v1/explorer/leaderboard?category=uptime&period=24h
GET /v1/explorer/sessions
GET /v1/explorer/earnings?period=24h
GET /v1/explorer/bandwidth?period=24h
GET /v1/explorer/contracts
GET /v1/explorer/contracts/:address
```

**Issues:**
- No validation middleware on query parameters
- No structured error response codes -- generic 500 messages
- No max page size enforcement
- No HTTP cache headers -- every request hits the database regardless of staleness

---

## 5. WebSocket Backend (`services/control-api/internal/api/explorer_ws.go`)

Polls DB every 5 seconds for new transactions and blocks, broadcasts to all clients.

| Issue | Severity |
|-------|----------|
| Race condition: mutex released during broadcast then re-acquired for iteration | Medium |
| Slow clients dropped after 100ms write timeout -- no buffer/queue | Medium |
| No connection limits -- potential DoS vector | Medium |
| No client authentication | Low (public explorer) |
| Only last 5 tx/blocks per poll cycle -- burst events are missed | Low |

---

## 6. Database Models (`services/control-api/internal/models/explorer.go`)

**Tables:** `explorer_blocks`, `explorer_transactions`, `explorer_nodes`, `explorer_contracts`, `explorer_metrics`

| Issue | Impact |
|-------|--------|
| No composite indexes on `(timestamp, chain)` | Slow pagination at scale |
| `RawData` stored as unindexed text on transactions | Inefficient queries |
| No soft deletes on nodes/contracts | No audit trail |
| `AverageBlockTime` precision limited to 4 decimal places | Minor |

---

## 7. Broken Routes Summary

| Route | Status | Impact |
|-------|--------|--------|
| `/explorer/wallets/[address]` | Page file missing | 404 on all wallet lookups |
| `/explorer/blocks/[number]` | Page file missing | 404 on all block detail clicks |
| `/explorer/nodes/[id]` | Page file missing | 404 on all node detail clicks |
| `/explorer/search` | Page file missing | 404 from sidebar link |
| `/explorer/contracts` | Page file missing | 404 from sidebar link |

---

## 8. All Issues By Priority

### Critical
1. 5 missing page files -- broken 404 routes visible to all users
2. WebSocket timestamp overridden with `new Date()` -- transactions show wrong time in live feed
3. WebSocket status hardcoded as `"confirmed"` -- incorrect for pending/failed transactions
4. Session duration inflates on every render -- shows wildly incorrect values for active sessions
5. Silent leaderboard/analytics fallback -- users see wrong data with no indication API failed

### High
6. Hardcoded `"99.9%"` consensus rate on dashboard
7. Null access on `metrics.avg_block_time_ms` -- potential crash if field absent from API response
8. Client-side-only transaction filtering -- filter applies only to current page
9. Heatmap toggle wired to state but state never passed to map component -- dead UI control
10. No error states displayed anywhere when API calls fail

### Medium
11. Map downloads all 200 nodes client-side -- no server-side geo filtering
12. Sort comparator in nodes list crashes on null string fields
13. `formatBytes()` unguarded for negative/NaN input
14. WebSocket reconnect cleanup race condition
15. `getNetworkStats()` redundant with `getExplorerMetrics()`

### Low
16. Date formatting silently falls back to raw ISO string on parse error
17. No ARIA labels on charts, tables, or map interactions
18. Rank calculation ignores ties in leaderboard
19. Hardcoded response time health thresholds (200ms/500ms)
20. `window.location.reload()` used as error recovery on node map

---

## 9. Missing Features

| Feature | Current State |
|---------|---------------|
| Search page | Not implemented -- nav link is dead |
| Contract browser | Not implemented -- backend + service layer ready |
| Wallet detail page | Not implemented -- service layer ready |
| Block detail page | Not implemented -- service layer ready |
| Node detail page | Not implemented -- service layer ready |
| Transaction detail page | Not implemented -- service layer ready |
| Data export (CSV/JSON) | Not implemented |
| Real-time heatmap | UI toggle exists but feature is non-functional |
| Server-side transaction filtering | Not implemented |
| Historical date range selection | Only preset periods (24h/7d/30d) |
| Node comparison view | Not implemented |
| Threshold-based alerts | Not implemented |

---

## 10. Status Overview Table

| Page | Working | Top Issue | Priority |
|------|---------|-----------|----------|
| Dashboard | Yes | Hardcoded values, no error states | High |
| Nodes List | Yes | Null crash in sort, no detail page | High |
| Transactions | Yes | Client-only filter | Medium |
| Wallets | **Broken** | Detail page missing | Critical |
| Blocks | Partial | Detail page missing | Critical |
| Analytics | Yes | Silent leaderboard fallback | Medium |
| Leaderboard | Yes | Silent fallback, ties not handled | Medium |
| Node Map | Yes | Heatmap broken, 200-node client download | Medium |
| Sessions | Yes | Duration calculation wrong | High |
| Earnings | Yes | Minor rank counter issue | Low |
| Health | Yes | Event log always empty | Low |
| Search | **Broken** | Page not implemented | Critical |
| Contracts | **Broken** | Page not implemented | Critical |
| WebSocket | Yes | Timestamp/status data corruption | High |

---

## 11. Recommended Work Order

### Phase 1 -- Fix Broken Routes (implement missing pages)
1. `/explorer/wallets/[address]` -- wallet detail: balance, tx history, linked user
2. `/explorer/blocks/[number]` -- block detail: hash, time, full tx list
3. `/explorer/nodes/[id]` -- node detail: uptime history, sessions, earnings, location
4. `/explorer/search` -- unified search: tx hash, address, block number, node ID
5. `/explorer/contracts` -- contract browser: list + detail view

### Phase 2 -- Fix Data Correctness Bugs
6. Fix WebSocket tx timestamp -- use server value, not `new Date()`
7. Fix WebSocket tx status -- use server value, not hardcoded `"confirmed"`
8. Fix session duration for active sessions -- stable server-side elapsed calculation
9. Remove hardcoded `"99.9%"` consensus rate -- pull from API
10. Add null guard on `metrics.avg_block_time_ms` and all optional metric fields

### Phase 3 -- Fix Silent Failures
11. Add error states to dashboard (show message when API call fails)
12. Show indicator when leaderboard/analytics fall back to local data
13. Move transaction filtering to server-side -- send `type` and `status` as query params
14. Add logging to WebSocket error handler

### Phase 4 -- UX and Performance
15. Server-side geo filtering for node map (avoid 200-node download)
16. Wire `showHeatmap` state to `LeafletMap` component
17. Add null guards to nodes list sort comparator
18. Guard `formatBytes()` for negative/NaN input
19. Make health thresholds configurable via system config API

### Phase 5 -- New Features
20. Data export (CSV) for transactions, sessions, and earnings tables
21. Full-text search with address/hash/block number lookup
22. Historical date range picker (not just preset periods)
23. Real-time heatmap on node map
24. Node comparison side-by-side view

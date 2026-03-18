# ProxyHubb — Node Map Engine: Analysis & Architecture Report

**Date:** 2026-03-17
**Scope:** Full analysis of the Proxy Explorer Node Map — current state, architecture, data flow, gaps, and recommended rebuild plan.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current Architecture Overview](#2-current-architecture-overview)
3. [Frontend: Pages & Components](#3-frontend-pages--components)
4. [Data Models & Type System](#4-data-models--type-system)
5. [API Layer](#5-api-layer)
6. [Real-Time WebSocket Layer](#6-real-time-websocket-layer)
7. [Database Schema](#7-database-schema)
8. [Current Map Implementation Details](#8-current-map-implementation-details)
9. [Critical Issues & Gaps](#9-critical-issues--gaps)
10. [Proposed Rebuild Architecture](#10-proposed-rebuild-architecture)
11. [File-by-File Inventory](#11-file-by-file-inventory)

---

## 1. Executive Summary

The current node map in `/explorer/map` is a functional but **fragile, data-starved** implementation built on Leaflet + react-leaflet. It works as a proof-of-concept but has fundamental problems that make it unsuitable for a production map engine:

- **Coordinate data is largely missing.** Most nodes return `latitude=0, longitude=0`. The map covers this up with 98 hardcoded fallback country/region coordinates. A real map engine requires real GeoIP resolution at node registration/heartbeat time.
- **Clustering is DIY.** Instead of a proper cluster library, the current code groups nodes into 1° grid squares using `Math.round(lat / 1) * 1`. This produces inaccurate clusters and doesn't scale.
- **No streaming updates to the map.** The WebSocket hub broadcasts transactions and blocks, but node position/status updates are polled every 30 seconds. The map has no live-update capability.
- **Hard cap of 500 nodes** — the map query is `page_size=500`, silently dropping any nodes beyond that.
- **The heatmap is unimplemented** — there is a toggle button and a `showHeatmap` state, but the canvas overlay draws nothing meaningful.
- **No interactivity beyond a popup** — no filtering by health metrics, no animated arcs for active sessions, no connection visualization between nodes.

The sections below document everything in detail and propose a clean rebuild path.

---

## 2. Current Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        BROWSER (Next.js)                        │
│                                                                 │
│  /explorer/map/page.tsx                                         │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  React Query → getNodes(page=1, page_size=500)          │    │
│  │  Filters: showValidators, showActiveOnly, selectedRegion│    │
│  │  Client-side cluster: Math.round(lat/1) grid            │    │
│  │  Fallback coords: REGION_COORDS / COUNTRY_COORDS tables │    │
│  └───────────────────┬────────────────────────────────────┘    │
│                       │                                         │
│  /explorer/map/LeafletMap.tsx                                   │
│  ┌────────────────────▼────────────────────────────────────┐    │
│  │  react-leaflet MapContainer                              │    │
│  │  Tile: CARTO dark_all                                   │    │
│  │  DivIcon custom markers (18–42px)                       │    │
│  │  Popup: HTML string templates                           │    │
│  │  Heatmap: canvas layer (NOT implemented)                │    │
│  └─────────────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────────┘
                             │  HTTP GET
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Go Control API (control-api)                    │
│                                                                 │
│  GET /v1/explorer/nodes?page=&page_size=&active=&validator=     │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  explorer.go → handleGetNodes()                        │    │
│  │  GORM query: explorer_nodes WHERE filters              │    │
│  │  Response: { nodes[], total, active, page, page_size } │    │
│  └───────────────────────────┬────────────────────────────┘    │
│                               │                                 │
│  WebSocket: /v1/explorer/ws                                     │
│  ┌────────────────────────────▼────────────────────────────┐    │
│  │  explorer_ws.go → ExplorerHub                           │    │
│  │  5s ticker → polls DB for new tx/blocks                 │    │
│  │  Broadcasts: new_transaction, new_block, node_update    │    │
│  └─────────────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      PostgreSQL Database                        │
│                                                                 │
│  explorer_nodes    (lat/lon often 0 — geo migration recent)     │
│  explorer_transactions                                          │
│  explorer_blocks                                                │
│  provider_nodes    (separate table, not used in explorer map)   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Frontend: Pages & Components

### 3.1 Explorer Section — Full Page Map

| Route | File | Status |
|-------|------|--------|
| `/explorer` | `apps/web/src/app/explorer/page.tsx` | ✅ Complete |
| `/explorer/nodes` | `apps/web/src/app/explorer/nodes/page.tsx` | ✅ Complete |
| `/explorer/nodes/[id]` | `apps/web/src/app/explorer/nodes/[id]/page.tsx` | ✅ Complete |
| `/explorer/nodes/compare` | `apps/web/src/app/explorer/nodes/compare/` | ⚠️ Exists, not verified |
| `/explorer/map` | `apps/web/src/app/explorer/map/page.tsx` | ⚠️ Partial — coord data missing |
| `/explorer/transactions` | `apps/web/src/app/explorer/transactions/page.tsx` | ⚠️ Exists, not verified |
| `/explorer/blocks/[number]` | `apps/web/src/app/explorer/blocks/[number]/` | ⚠️ Exists, not verified |
| `/explorer/analytics` | `apps/web/src/app/explorer/analytics/` | ⚠️ Exists, not verified |
| `/explorer/leaderboard` | `apps/web/src/app/explorer/leaderboard/` | ⚠️ Exists, not verified |
| `/explorer/sessions` | `apps/web/src/app/explorer/sessions/` | ⚠️ Exists, not verified |
| `/explorer/earnings` | `apps/web/src/app/explorer/earnings/` | ⚠️ Exists, not verified |
| `/explorer/health` | `apps/web/src/app/explorer/health/` | ⚠️ Exists, not verified |
| `/explorer/search` | `apps/web/src/app/explorer/search/` | ⚠️ Exists, not verified |
| `/explorer/wallets/[address]` | `apps/web/src/app/explorer/wallets/[address]/` | ⚠️ Exists, not verified |

### 3.2 Map Component Architecture (Current)

```
apps/web/src/app/explorer/map/
├── page.tsx          — Filter UI, region sidebar, node table
└── LeafletMap.tsx    — Map rendering, marker logic, popup templates
```

**page.tsx responsibilities:**
- Fetches nodes via `getNodes({ page: 1, page_size: 500 })`
- Client-side clustering: groups nodes into 1° lat/lon grid
- Region breakdown: groups by `node.region || node.country`
- Region filter: zooms map and re-clusters
- Statistics: total, active, validators, plotted, unmapped

**LeafletMap.tsx responsibilities:**
- Renders CARTO dark tile layer
- Renders one `DivIcon` marker per cluster
- Color logic: green (active proxy), purple (validator), red (offline), amber (selected)
- Popup: HTML string with node name, region, status, uptime
- Heatmap toggle: `showHeatmap` state — **canvas draws nothing (not implemented)**
- Auto-fit bounds when `selectedRegion` changes

### 3.3 Sidebar Navigation (Explorer Section)

```
apps/web/src/components/Sidebar.tsx

Explorer
├── Overview        (Blocks icon)          /explorer
├── Nodes           (Server icon)          /explorer/nodes
├── Transactions    (ArrowRightLeft)       /explorer/transactions
├── Leaderboard     (Trophy)               /explorer/leaderboard
├── Sessions        (Radio)                /explorer/sessions
├── Earnings        (Coins)                /explorer/earnings
├── Analytics       (BarChart3)            /explorer/analytics
├── Health          (ShieldCheck)          /explorer/health
├── Node Map        (Network)              /explorer/map         ← TARGET
├── Search          (Search)               /explorer/search
├── Wallets         (Wallet)               /explorer/wallets
└── Contracts       (FileCode)             /explorer/contracts
```

---

## 4. Data Models & Type System

### 4.1 TypeScript Interfaces (`apps/web/src/lib/services/explorer.ts`)

```typescript
// Core node type used by the map
interface NodeSummary {
  node_id: string
  name?: string
  chain: string
  region: string
  country: string
  city?: string
  isp?: string
  latitude: number       // Frequently 0 — missing GeoIP data
  longitude: number      // Frequently 0 — missing GeoIP data
  is_active: boolean
  is_validator: boolean
  uptime_percent: number
  active_sessions: number
  bandwidth_gb: number
  last_heartbeat: string
}

// Extended node for detail page
interface NodeDetail extends NodeSummary {
  stake_amount: number
  commission_rate: number
  latency_ms: number
  quality_score: number       // 0–100 composite score
  success_rate: number
  active_sessions: number
  total_sessions: number
  bytes_up: number
  bytes_down: number
  version?: string
  hotkey?: string
}

// Paginated list response
interface NodeListResponse {
  nodes: NodeSummary[]
  total: number
  active: number
  page: number
  page_size: number
}
```

### 4.2 Go Database Model (`services/control-api/internal/models/explorer.go`)

```go
type ExplorerNode struct {
  ID             uuid.UUID  `gorm:"type:uuid;primaryKey"`
  NodeID         string     `gorm:"uniqueIndex;not null"`
  Chain          string     `gorm:"not null;default:'solana'"`
  Name           string
  IP             string     // Hidden in API responses
  Region         string
  Country        string
  City           string     // Added in migration 000039
  ISP            string     // Added in migration 000039
  Latitude       float64    `gorm:"type:numeric(10,6)"` // Added in migration 000039
  Longitude      float64    `gorm:"type:numeric(10,6)"` // Added in migration 000039
  IsActive       bool       `gorm:"default:false"`
  IsValidator    bool       `gorm:"default:false"`
  StakeAmount    float64
  CommissionRate float64
  UptimePercent  float64    `gorm:"type:numeric(5,2)"`
  TotalBandwidth uint64
  ActiveSessions int
  LastHeartbeat  time.Time
  Version        string
  CreatedAt      time.Time
  UpdatedAt      time.Time
}
```

---

## 5. API Layer

### 5.1 REST Endpoints (`services/control-api/internal/api/explorer.go`)

```
GET  /v1/explorer/metrics          — Aggregated network metrics
GET  /v1/explorer/stats            — Quick stats snapshot
GET  /v1/explorer/transactions     — Paginated transaction list
GET  /v1/explorer/transactions/:hash — Single transaction
GET  /v1/explorer/wallets/:address — Wallet overview
GET  /v1/explorer/wallets/:address/transactions
GET  /v1/explorer/blocks           — Paginated block list
GET  /v1/explorer/blocks/:identifier
GET  /v1/explorer/nodes            — Paginated node list (used by map)
GET  /v1/explorer/nodes/:id        — Single node detail
GET  /v1/explorer/validators       — Validator-only list
GET  /v1/explorer/bandwidth        — Bandwidth stats (24h/7d/30d)
GET  /v1/explorer/network/health   — Subsystem health status
GET  /v1/explorer/analytics        — Time-series analytics
GET  /v1/explorer/leaderboard      — Ranked node list
GET  /v1/explorer/earnings         — Provider earnings
GET  /v1/explorer/sessions         — Active proxy sessions
GET  /v1/explorer/health/history   — Historical health events
```

**Missing for a proper map engine:**
- `GET /v1/explorer/nodes/geo` — Lightweight endpoint with only `[node_id, lat, lon, is_active, is_validator]` for fast map loads
- `GET /v1/explorer/nodes/clusters?zoom=&bbox=` — Server-side clustering at zoom level
- `GET /v1/explorer/nodes/heatmap?bbox=` — Heatmap density data
- `GET /v1/explorer/sessions/active/geo` — Active session paths for arc visualization

### 5.2 Service Layer (`apps/web/src/lib/services/explorer.ts`)

```typescript
// Currently used by map
getNodes(params?: { page?, page_size?, active?, validator? })
  → Promise<NodeListResponse>

// Not used by map but should be:
getNodeDetail(id: string) → Promise<NodeDetail>
getLeaderboard(category, period) → Promise<LeaderboardEntry[]>
getNetworkHealth() → Promise<NetworkHealth>
```

---

## 6. Real-Time WebSocket Layer

### 6.1 Backend Hub (`services/control-api/internal/api/explorer_ws.go`)

```go
type ExplorerHub struct {
  clients    map[*websocket.Conn]bool
  broadcast  chan ExplorerUpdate  // buffer: 256
  register   chan *websocket.Conn
  unregister chan *websocket.Conn
  mu         sync.RWMutex
}

// Polling loop (every 5s)
// → Checks for new transactions since lastTxTime
// → Checks for new blocks since lastBlockNumber
// → Broadcasts to all clients
```

**Message types:**
| Type | Payload |
|------|---------|
| `initial` | Last 10 transactions |
| `new_transaction` | `{tx_hash, from, to, amount, currency, tx_type}` |
| `new_block` | `{block_number, block_hash, transaction_count}` |
| `node_update` | `{node_id, is_active, uptime_percent, active_sessions}` |

### 6.2 Frontend Hook (`apps/web/src/lib/hooks/useExplorerWS.ts`)

```typescript
useExplorerWS({
  onNewTransaction: (data) => void,
  onNewBlock: (data) => void,
  onNodeUpdate: (data) => void,    // ← Map should subscribe to this
  onInitial: (data) => void,
})
// Auto-reconnects after 5s
// Endpoint: ws(s)://API_URL/v1/explorer/ws
```

**Current problem:** The map page does NOT use `useExplorerWS`. Node updates happen via React Query polling every 30s, not through WebSocket.

---

## 7. Database Schema

### 7.1 explorer_nodes Table

```sql
CREATE TABLE explorer_nodes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id         VARCHAR NOT NULL UNIQUE,
  chain           VARCHAR NOT NULL DEFAULT 'solana',
  name            VARCHAR,
  ip              VARCHAR,           -- Not exposed to frontend
  region          VARCHAR,
  country         VARCHAR,
  city            VARCHAR(100) DEFAULT '',    -- migration 000039
  isp             VARCHAR(200) DEFAULT '',    -- migration 000039
  latitude        NUMERIC(10,6) DEFAULT 0,   -- migration 000039
  longitude       NUMERIC(10,6) DEFAULT 0,   -- migration 000039
  is_active       BOOLEAN DEFAULT false,
  is_validator    BOOLEAN DEFAULT false,
  stake_amount    FLOAT,
  commission_rate FLOAT,
  uptime_percent  NUMERIC(5,2),
  total_bandwidth BIGINT,
  active_sessions INT,
  last_heartbeat  TIMESTAMP,
  version         VARCHAR,
  created_at      TIMESTAMP,
  updated_at      TIMESTAMP
);
```

**Key problem:** Migration `000039` added `city`, `isp`, `latitude`, `longitude` as new columns with `DEFAULT 0`. This means all existing nodes have `latitude=0, longitude=0`. There is no background job that backfills GeoIP data from the `ip` column.

### 7.2 Related Tables

```sql
-- Separate from explorer_nodes (provider-owned nodes)
provider_nodes (
  id, user_id, name, ip, region, country, status, ...
)

-- Used by heartbeat monitor
-- When nodes send heartbeats, they should update explorer_nodes lat/lon
-- Currently unclear if this pipeline exists
```

---

## 8. Current Map Implementation Details

### 8.1 Tile Layer

```
URL:    https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png
Theme:  Dark (matches app UI)
Zoom:   min=1, max=10
```

### 8.2 Clustering Algorithm (Current — Flawed)

```javascript
// Crude 1° grid grouping in page.tsx
const clusterKey = `${Math.round(lat / 1) * 1},${Math.round(lon / 1) * 1}`
clusters[clusterKey] = { nodes: [...], avgLat, avgLon }
```

**Problems:**
- 1° resolution = ~111km at equator — too coarse
- No zoom-adaptive clustering
- Does not use a proper algorithm (Supercluster, MarkerCluster, etc.)

### 8.3 Marker Rendering

```javascript
// DivIcon with inline CSS
// Color by node type:
const color = {
  offline:   '#ef4444',  // red
  validator: '#a855f7',  // purple
  active:    '#22c55e',  // green
}
// Size: 18 + count * 3, max 42px
// Pulsing animation: 2.5s CSS keyframe
// Glow: box-shadow with 0.3 opacity
```

### 8.4 Fallback Coordinate Tables (Current Workaround)

```typescript
// 98 hardcoded entries per table

const REGION_COORDS: Record<string, [number, number]> = {
  'us-east':      [37.09, -95.71],
  'eu-west':      [53.35, -6.26],
  'ap-southeast': [1.35, 103.82],
  // ... 95 more
}

const COUNTRY_COORDS: Record<string, [number, number]> = {
  'US': [37.09, -95.71],
  'United States': [37.09, -95.71],
  'DE': [51.17, 10.45],
  // ... 95 more
}
```

**These are center-of-country dots, not real node positions.** Multiple nodes in the same country all appear on the same point.

### 8.5 Heatmap (Unimplemented)

```typescript
// Toggle exists in UI
const [showHeatmap, setShowHeatmap] = useState(false)

// In LeafletMap.tsx — canvas layer registered but draws nothing:
// No density calculation, no color gradient, no kernel estimation
```

---

## 9. Critical Issues & Gaps

### P0 — Blocking

| # | Issue | Impact |
|---|-------|--------|
| 1 | `latitude=0, longitude=0` for all existing nodes | Map is meaningless without real coords |
| 2 | No GeoIP backfill pipeline | Node registration never sets lat/lon from IP |
| 3 | Hard limit of 500 nodes in map query | Silently drops nodes in large networks |
| 4 | Heatmap toggle is a no-op | Feature advertised but not functional |

### P1 — Major

| # | Issue | Impact |
|---|-------|--------|
| 5 | DIY clustering is zoom-invariant | Markers overlap at high zoom levels |
| 6 | Map not connected to WebSocket | Node status changes not reflected in real time |
| 7 | All nodes fetched in one REST call | Slow page load, no spatial query optimization |
| 8 | No dedicated geo endpoint | Fetching full node objects just for lat/lon |

### P2 — Minor / Enhancement

| # | Issue | Impact |
|---|-------|--------|
| 9 | WS hub has no subscription filtering | All clients receive all events |
| 10 | WS slow-client timeout is 100ms | Legitimate slow networks get disconnected |
| 11 | No connection arc visualization | Active sessions between nodes not visible |
| 12 | Popup uses raw HTML strings | XSS risk, not maintainable |
| 13 | No bounding-box query for visible area | Loads nodes outside viewport |

---

## 10. Proposed Rebuild Architecture

### 10.1 New Map Engine Stack

| Layer | Current | Proposed |
|-------|---------|----------|
| Map library | `react-leaflet 5` | Keep — add `supercluster` |
| Tile layer | CARTO dark_all | Keep |
| Clustering | DIY 1° grid | `supercluster` with zoom-adaptive radius |
| Heatmap | Unimplemented canvas | `leaflet.heat` (lightweight) |
| Coordinate source | Hardcoded tables | Real GeoIP via `maxminddb-golang` on heartbeat |
| Data loading | Single 500-node REST call | Server-side geo endpoint + streaming |
| Real-time updates | 30s React Query poll | WebSocket `node_update` events → map state |
| Popups | HTML string templates | React portals via `L.popup().setContent(domNode)` |
| Connection arcs | Not implemented | `L.polyline` with curved paths per active session |

### 10.2 Backend Additions Required

```
services/control-api/internal/api/
├── explorer.go              (add /nodes/geo endpoint)
├── explorer_ws.go           (add subscription filtering by topic)

services/control-api/internal/
├── geoip/
│   ├── resolver.go          (MaxMind GeoLite2 lookup)
│   └── cache.go             (Redis-backed IP→coords cache)

services/control-api/internal/worker/
├── heartbeat_monitor.go     (update: write lat/lon on heartbeat)
```

**New REST Endpoints:**
```
GET /v1/explorer/nodes/geo
    → [{ node_id, lat, lon, is_active, is_validator, uptime_percent }]
    Lightweight — no bandwidth/session data
    Query params: active=true/false, validator=true/false

GET /v1/explorer/nodes/clusters?zoom=&sw_lat=&sw_lon=&ne_lat=&ne_lon=
    → [{ lat, lon, count, active_count, has_validator }]
    Server-side supercluster output for given viewport

GET /v1/explorer/nodes/heatmap?bbox=swlat,swlon,nelat,nelon
    → [{ lat, lon, weight }]   where weight = active_sessions or uptime
```

### 10.3 Frontend File Structure (Rebuild)

```
apps/web/src/app/explorer/map/
├── page.tsx                 — Top-level page: layout, filter sidebar, stats
├── MapEngine.tsx            — Main map wrapper, data orchestration
├── layers/
│   ├── NodeLayer.tsx        — Supercluster marker layer
│   ├── HeatmapLayer.tsx     — leaflet.heat density layer
│   └── SessionArcLayer.tsx  — L.polyline active session connections
├── markers/
│   ├── ClusterMarker.tsx    — React component for cluster dot
│   └── NodeMarker.tsx       — Single node marker
├── popups/
│   └── NodePopup.tsx        — React portal popup content
├── controls/
│   ├── FilterPanel.tsx      — Active/validator/region toggles
│   ├── LayerControl.tsx     — Heatmap/arcs/labels toggles
│   └── MapStats.tsx         — Live statistics HUD
└── hooks/
    ├── useNodeGeo.ts        — Fetches /nodes/geo, handles refresh
    ├── useMapWS.ts          — Subscribes to node_update WS events
    └── useCluster.ts        — Supercluster computation, zoom-aware
```

### 10.4 Data Flow (Rebuild)

```
Initial Load:
  GET /v1/explorer/nodes/geo
    → lightweight node positions array
    → supercluster.load(points)
    → render markers at current zoom

Zoom/Pan:
  map.on('moveend') / map.on('zoomend')
    → supercluster.getClusters(bbox, zoom)
    → update only visible markers (no re-fetch)

Real-time Updates:
  WS 'node_update' event
    → update local node record (is_active, uptime_percent)
    → update marker color without full re-render
    → show pulse animation on changed node

Filter Change:
  Filter state changes
    → re-run supercluster.getClusters() with filtered points
    → no API call needed (data already loaded)

Heatmap:
  Toggle ON
    → compute weight per point from is_active + active_sessions
    → leaflet.heat.setLatLngs(weightedPoints)
    → render density gradient

Session Arcs (optional):
  GET /v1/explorer/sessions/active/geo
    → [{from_node_id, to_node_id, session_count}]
    → draw curved polylines between node pairs
```

### 10.5 GeoIP Pipeline (Backend)

```
Node heartbeat received
  → services/control-api/internal/worker/heartbeat_monitor.go
  → if explorer_node.latitude == 0 AND node.ip != ""
      → geoip.Resolve(node.ip)
        → check Redis cache first
        → else MaxMind GeoLite2 mmdb lookup
        → cache result for 24h
      → UPDATE explorer_nodes SET
          latitude=?, longitude=?, city=?, isp=?
          WHERE node_id=?
      → geoip.NotifyNodeUpdate(hub, node)  → WS broadcast
```

### 10.6 WebSocket Subscription Filtering

```go
// Current: all clients receive all events
hub.broadcast <- update

// Proposed: topic subscriptions
type Client struct {
  conn   *websocket.Conn
  topics map[string]bool  // "transactions", "blocks", "nodes", "map"
}

// Client subscribes on connect:
// { "type": "subscribe", "topics": ["nodes", "map"] }

// Map page only subscribes to "nodes" topic
// Transactions page subscribes to "transactions", "blocks"
```

---

## 11. File-by-File Inventory

### Frontend

| File | Lines | Purpose | Issues |
|------|-------|---------|--------|
| `apps/web/src/app/explorer/map/page.tsx` | ~400 | Map page, filters, stats, region sidebar | DIY clustering, 500 limit, no WS |
| `apps/web/src/app/explorer/map/LeafletMap.tsx` | ~350 | Leaflet map render, markers, popups | Heatmap not implemented, HTML string popups |
| `apps/web/src/app/explorer/page.tsx` | ~500 | Explorer dashboard, live feed | Good overall |
| `apps/web/src/app/explorer/nodes/page.tsx` | ~350 | Paginated node list | Good overall |
| `apps/web/src/app/explorer/nodes/[id]/page.tsx` | ~280 | Node detail | Good overall |
| `apps/web/src/lib/services/explorer.ts` | ~200 | API service + TypeScript types | Missing geo endpoint |
| `apps/web/src/lib/hooks/useExplorerWS.ts` | ~80 | WebSocket hook | Good — not used by map |

### Backend

| File | Lines | Purpose | Issues |
|------|-------|---------|--------|
| `services/control-api/internal/api/explorer.go` | ~600 | REST handlers | Missing geo/cluster endpoints |
| `services/control-api/internal/api/explorer_ws.go` | ~180 | WebSocket hub | No topic filtering, 100ms timeout |
| `services/control-api/internal/models/explorer.go` | ~120 | DB models | Good — geo columns added |
| `services/control-api/internal/worker/heartbeat_monitor.go` | ~? | Node heartbeat processing | GeoIP update not implemented |

### Database Migrations

| Migration | Status | Notes |
|-----------|--------|-------|
| `000039_explorer_node_geo.up.sql` | ✅ Applied | Added city, isp, lat, lon — defaults to 0 |
| GeoIP backfill | ❌ Missing | No migration to populate existing nodes |

---

## Summary & Recommendation

The Proxy Explorer Node Map exists as a working scaffold but is **not production-ready** because its most critical data (geographic coordinates) is either missing or hardcoded. Before building new features on top of it, we need to:

1. **Fix the data pipeline** — implement GeoIP resolution in the heartbeat monitor so `latitude` and `longitude` are populated as nodes connect.
2. **Rebuild the map component** with proper `supercluster` clustering instead of the DIY 1° grid.
3. **Add a `/nodes/geo` endpoint** so the map fetches lightweight geo data, not full node objects.
4. **Connect the map to the WebSocket** so node status changes appear in real time.
5. **Implement the heatmap** using `leaflet.heat` against real coordinate data.

The rebuild should proceed in this order: **Backend geo pipeline → API geo endpoint → Frontend MapEngine rebuild → Real-time WS integration → Heatmap → Session arcs**.

---

*End of Report — Ready for review before implementation begins.*

# Node Map Analysis Report
## ProxyHubb Proxy Explorer - Comprehensive Issue Analysis

**Report Date:** 2026-03-15  
**Component:** Proxy Explorer Node Map (`/explorer/map`)  
**Status:** 🔴 CRITICAL ISSUES IDENTIFIED

---

## Executive Summary

The Node Map in the Proxy Explorer is currently **non-functional** - displaying "0 NODES PLOTTED" with all statistics showing zero values. This is caused by a **data flow breakdown** from the backend API through to the frontend visualization. The map UI components are working correctly, but no node data is being fetched or displayed.

---

## Issue 1: Backend API Data Flow Failure (CRITICAL)

### Problem Description
The API request to fetch nodes is timing out or returning empty data. The frontend makes a request to:
```
GET /v1/explorer/nodes?page=1&page_size=200&active=false
```

This request proxies through Next.js to the backend at `http://localhost:8080` (or `API_URL` env var).

### Root Causes Identified

#### 1.1 Backend Service Not Running
- **Evidence:** API calls timeout after 10 seconds
- **Location:** `apps/web/next.config.ts` line 45
- **Configuration:** 
  ```typescript
  const apiUrl = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  ```
- **Issue:** The control-api service at port 8080 is not accessible

#### 1.2 Missing Environment Configuration
- **Evidence:** No `.env` file exists in `apps/web/`
- **Impact:** API requests cannot reach the backend
- **Required Fix:** Create `apps/web/.env.local` with:
  ```
  API_URL=http://localhost:8080
  ```

#### 1.3 Database Empty or Not Migrated
- **Evidence:** Even if API connects, `ExplorerNode` table may be empty
- **Location:** `services/control-api/internal/models/explorer.go` lines 47-67
- **Related Files:**
  - `services/control-api/internal/indexer/node_sync.go` - Node synchronization service
  - `services/control-api/internal/db/node.go` - Node database operations

### Code References

**Frontend Data Fetching:**
```typescript
// apps/web/src/lib/services/explorer.ts lines 168-172
export async function getNodes(page = 1, pageSize = 20, activeOnly = true): Promise<NodeListResponse> {
    const response = await fetch(`${API_BASE_URL}/v1/explorer/nodes?page=${page}&page_size=${pageSize}&active=${activeOnly}`);
    if (!response.ok) throw new Error('Failed to fetch nodes');
    return response.json();
}
```

**Backend API Handler:**
```go
// services/control-api/internal/api/explorer.go lines 684-745
func listExplorerNodes(c *gin.Context) {
    // Filters by chain = "solana" and active status
    query := db.DB.Model(&models.ExplorerNode{}).Where("chain = ?", "solana")
    // ...
}
```

---

## Issue 2: Node Synchronization Service (CRITICAL)

### Problem Description
The `NodeSync` service that populates the `ExplorerNode` table from the main `Node` table may not be running.

### Code Analysis

**NodeSync Service (`services/control-api/internal/indexer/node_sync.go`):**
- Lines 15-23: Service structure defined
- Lines 46-64: Start method with 5-minute sync interval
- Lines 97-127: Main sync logic
- **Critical Issue:** The service only syncs nodes where `is_healthy = true` (line 103)

**Sync Logic Flow:**
1. Queries main `nodes` table for healthy nodes
2. Maps region to country using hardcoded mapping (lines 302-321)
3. Creates/updates records in `explorer_nodes` table
4. Marks inactive nodes not in the active list

### Potential Issues

#### 2.1 No Healthy Nodes in Database
If no nodes have `is_healthy = true`, no explorer nodes will be created.

#### 2.2 Region Mapping Limitations
The `getCountryFromRegion` function (lines 302-321) has a limited mapping:
```go
regionMap := map[string]string{
    "us-east":      "United States",
    "us-west":      "United States",
    "eu-west":      "Ireland",
    "eu-central":   "Germany",
    "ap-south":     "India",
    "ap-southeast": "Singapore",
    "ap-northeast": "Japan",
    "sa-east":      "Brazil",
    "af-south":     "South Africa",
}
```

**Missing regions** like "ghana", "west-africa", "europe-west", etc. will not be properly mapped.

#### 2.3 NodeSync Not Started
The NodeSync service may not be initialized during application startup.

---

## Issue 3: Frontend Coordinate Mapping Gaps (HIGH)

### Problem Description
The frontend has hardcoded country/region coordinates but many common locations are missing.

### Code Location
`apps/web/src/app/explorer/map/page.tsx` lines 28-79

### Current Coverage (Limited)
**Available Countries (40):**
- North America: US, CA, MX
- Europe: GB, DE, FR, NL, SE, NO, FI, CH, PL, UA, TR, ES, IT, PT, RO, CZ, AT, BE, GR
- Asia: JP, SG, HK, KR, CN, IN, TH, VN, MY, PH, ID, IL, AE
- Africa: ZA, NG, EG
- South America: BR, AR
- Oceania: AU

### Missing Critical Regions

**Africa (15+ missing):**
- Ghana (!!!) - Critical for ProxyHubb (Ghana-based)
- Kenya, Nigeria (already included), Ethiopia
- Morocco, Algeria, Tunisia
- Tanzania, Uganda, Rwanda

**Europe (10+ missing):**
- Denmark, Ireland (partially mapped)
- Hungary, Slovakia, Croatia
- Serbia, Bulgaria, Lithuania
- Latvia, Estonia

**Asia (15+ missing):**
- Pakistan, Bangladesh, Sri Lanka
- Nepal, Myanmar, Cambodia
- Taiwan, Mongolia, Kazakhstan
- Saudi Arabia, Qatar, Kuwait
- Iraq, Iran, Jordan, Lebanon

**North America (5+ missing):**
- Costa Rica, Panama, Guatemala
- Cuba, Dominican Republic, Jamaica

**South America (5+ missing):**
- Chile, Peru, Colombia, Venezuela
- Ecuador, Bolivia, Paraguay, Uruguay

---

## Issue 4: Map Visualization Issues (MEDIUM)

### 4.1 Dark Map Contrast
**Location:** `apps/web/src/app/explorer/map/LeafletMap.tsx` lines 51-58

The map uses CartoDB Dark Matter tiles:
```typescript
L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20,
    }
).addTo(map);
```

**Problem:** With the dark theme of the ProxyHubb UI, the map boundaries are very subtle and hard to see, especially:
- Country borders are faint
- Ocean/land distinction is minimal
- Grid lines are barely visible

**Recommendation:** Consider adding:
1. A subtle grid overlay
2. Brighter country borders
3. Alternative tile layer for better visibility

### 4.2 Marker Size Scaling
**Location:** `apps/web/src/app/explorer/map/LeafletMap.tsx` line 100

```typescript
const size = Math.min(10 + count * 3, 28);
```

**Issue:** Single nodes (count=1) have a size of only 10px, which is very small on a world map view.

**Recommendation:** Increase minimum size to 16-20px for better visibility.

### 4.3 Missing Map Controls
The map is missing useful controls:
- Full-screen toggle
- Search by location
- Filter by node type (validator/proxy)
- Filter by status (active/offline)

---

## Issue 5: Data Display Issues (MEDIUM)

### 5.1 No Loading State Error Handling
**Location:** `apps/web/src/app/explorer/map/page.tsx` lines 106-111

```typescript
const { data: nodesData, isLoading } = useQuery({
    queryKey: ['nodes-map'],
    queryFn: () => getNodes(1, 200, false),
    refetchInterval: 30000,
    retry: false,  // <-- No retry on failure
});
```

**Issues:**
- `retry: false` means transient failures won't be retried
- No error state displayed to user
- "Fetching node positions..." stays forever if request fails

### 5.2 Empty State Not Informative
When no nodes exist, the UI shows:
- "0 NODES PLOTTED" 
- "No nodes yet"
- "No nodes registered yet"

**Missing:** Clear instructions on how to register nodes or troubleshoot.

---

## Issue 6: Performance Considerations (LOW)

### 6.1 Inefficient Clustering
**Location:** `apps/web/src/app/explorer/map/page.tsx` lines 116-140

The clustering algorithm uses a simple 2-degree grid bucketing:
```typescript
const key = `${Math.round(n.lat / 2)}_${Math.round(n.lon / 2)}`;
```

**Issues:**
- Grid size varies significantly by latitude
- Not using proper geospatial clustering (like DBSCAN or K-means)
- Could be slow with 1000+ nodes

### 6.2 Unnecessary Re-renders
The markers are recreated on every cluster change, causing map flicker.

---

## Fix Implementation Plan

### Phase 1: Backend Data Flow (CRITICAL)

1. **Verify Backend Service**
   ```bash
   # Check if control-api is running
   curl http://localhost:8080/health
   
   # Check explorer nodes endpoint
   curl "http://localhost:8080/v1/explorer/nodes?page=1&page_size=10"
   ```

2. **Start NodeSync Service**
   - Ensure `NodeSync.Start()` is called in `main.go` or service initialization
   - Verify database migration for `explorer_nodes` table

3. **Check Database Population**
   ```sql
   -- Check if nodes exist
   SELECT COUNT(*) FROM nodes WHERE is_healthy = true;
   
   -- Check explorer nodes
   SELECT COUNT(*) FROM explorer_nodes;
   
   -- Check specific regions
   SELECT region, COUNT(*) FROM explorer_nodes GROUP BY region;
   ```

### Phase 2: Environment Configuration (CRITICAL)

Create `apps/web/.env.local`:
```bash
API_URL=http://localhost:8080
NEXT_PUBLIC_API_URL=http://localhost:8080
```

### Phase 3: Frontend Fixes (HIGH)

1. **Add Error Handling** (`apps/web/src/app/explorer/map/page.tsx`)
```typescript
const { data: nodesData, isLoading, error } = useQuery({
    queryKey: ['nodes-map'],
    queryFn: () => getNodes(1, 200, false),
    refetchInterval: 30000,
    retry: 3, // Enable retry
});

// In render:
{error && (
    <div className="text-rose-400 text-center py-4">
        Failed to load nodes: {error.message}
    </div>
)}
```

2. **Expand Country Coordinates** (Add to `COUNTRY_COORDS`)
```typescript
// Africa additions
'GH': [7.9, -1.0], 'Ghana': [7.9, -1.0],
'KE': [-1.3, 36.8], 'Kenya': [-1.3, 36.8],
'ET': [9.1, 40.5], 'Ethiopia': [9.1, 40.5],
'MA': [31.8, -7.1], 'Morocco': [31.8, -7.1],
// ... (full list in recommendations)
```

3. **Improve Map Visibility** (`LeafletMap.tsx`)
```typescript
// Add grid overlay style
style.textContent += `
    .leaflet-grid-label { color: rgba(255,255,255,0.1); font-size: 8px; }
`;
```

4. **Increase Marker Sizes**
```typescript
const size = Math.min(16 + count * 3, 32); // Increased from 10 to 16
```

### Phase 4: UI/UX Improvements (MEDIUM)

1. **Add Filter Controls**
   - Toggle for validators only
   - Toggle for active nodes only
   - Region selector dropdown

2. **Improve Empty State**
   - Add link to documentation
   - Show "Register your first node" CTA
   - Display connection troubleshooting steps

3. **Add Map Legend**
   - Show color coding explanation
   - Display node count by type

---

## Testing Checklist

- [ ] Backend API returns nodes data
- [ ] NodeSync service populates ExplorerNode table
- [ ] Frontend displays nodes on map
- [ ] Markers are visible and clickable
- [ ] Region breakdown shows data
- [ ] Node table populates correctly
- [ ] Filters work correctly
- [ ] Mobile responsive layout
- [ ] Dark mode visibility good

---

## Additional Recommendations

1. **Add Real-time Updates**
   - Use WebSocket for live node updates
   - Show node status changes in real-time

2. **Geographic Analytics**
   - Add heatmap layer option
   - Show bandwidth usage by region
   - Display latency metrics

3. **Node Details Enhancement**
   - Add ISP information if available
   - Show node performance history
   - Link to node operator profile

---

## Conclusion

The Node Map issues stem primarily from a **backend data flow failure**. The frontend code is well-structured but lacks proper error handling for API failures. The immediate priority is to:

1. ✅ Verify backend service is running
2. ✅ Ensure database is populated with nodes
3. ✅ Fix environment configuration
4. ✅ Add comprehensive error handling
5. ✅ Expand geographic coverage
6. ✅ Improve map visibility

Once these fixes are implemented, the Node Map should display nodes correctly and provide a much better user experience.

---

**Report Generated:** 2026-03-15  
**Next Review:** After fixes implemented

# Quick Integration Guide

## Phase 1: Design System + Base Components ✓

### Step 1: Import CSS Variables

```tsx
import "./styles/variables.css";
```

### Step 2: Replace Existing Marker

```tsx
import { NodeMarker } from "./components/NodeMarker";

{nodes.map((node, index) => (
  <NodeMarker
    key={node.node_id}
    node={node}
    isSelected={selectedNode?.node_id === node.node_id}
    onClick={() => setSelectedNode(node)}
    index={index}
  />
))}
```

## Phase 2: Particle Effects + Connection Lines ✓

### Step 3: Add Connection Lines

```tsx
import { ConnectionLines, NetworkMesh } from "./effects";

<div id="map-container" className="relative w-full h-full">
  <NetworkMesh nodeCount={15} />
  
  <ConnectionLines
    nodes={nodes}
    maxConnections={3}
    connectionDistance={200}
    showOnlyForSelected={selectedNode?.node_id}
  />
  
  {nodes.map((node, index) => (
    <NodeMarker
      key={node.node_id}
      node={node}
      isSelected={selectedNode?.node_id === node.node_id}
      onClick={() => setSelectedNode(node)}
      index={index}
      mapX={node.x}
      mapY={node.y}
    />
  ))}
</div>
```

## Phase 3: Map Visual Styles ✓

### Step 4: Wrap with ThemeProvider

```tsx
import { ThemeProvider } from "./styles";

<ThemeProvider defaultTheme="dark">
  <YourMapComponent />
</ThemeProvider>
```

### Step 5: Add Theme Toggle & 3D Globe

```tsx
import { useMapTheme } from "./styles";
import { ThemeToggle } from "./controls";
import { GlobeView } from "./globe";

const { is3D } = useMapTheme();

// In your render:
<ThemeToggle className="absolute top-4 right-4 z-50" />

{is3D ? (
  <GlobeView
    nodes={nodes}
    selectedNodeId={selectedNode?.node_id}
    onNodeClick={setSelectedNode}
    width={window.innerWidth}
    height={window.innerHeight}
  />
) : (
  // Your 2D map
)}
```

### Step 6: Add Region Highlights

```tsx
import { RegionHighlight } from "./components";

<RegionHighlight
  regions={regions}
  selectedRegion={selectedRegion}
  onRegionClick={handleRegionClick}
/>
```

## Phase 4: Details Panel ✓

### Step 7: Add Node Details Panel

```tsx
import { NodeDetailsPanel } from "./panel";

<AnimatePresence>
  {selectedNode && (
    <NodeDetailsPanel
      node={{
        node_id: selectedNode.node_id,
        city: selectedNode.city,
        country: selectedNode.country,
        region: selectedNode.region,
        is_active: selectedNode.is_active,
        is_validator: selectedNode.is_validator,
        uptime_percent: selectedNode.uptime_percent,
        active_sessions: selectedNode.active_sessions,
        latency_ms: selectedNode.latency_ms || 45,
        bandwidth_mbps: selectedNode.bandwidth_mbps || 850,
        cpu_percent: selectedNode.cpu_percent || 35,
        memory_percent: selectedNode.memory_percent || 62,
        disk_usage_gb: selectedNode.disk_usage_gb || 45,
        total_bandwidth_tb: selectedNode.total_bandwidth_tb || 12.5,
        rewards_24h: selectedNode.rewards_24h || 2.45,
        rewards_total: selectedNode.rewards_total || 156.78,
        first_seen: selectedNode.first_seen,
        last_seen: selectedNode.last_seen,
        version: selectedNode.version || "v2.4.1",
      }}
      onClose={() => setSelectedNode(null)}
    />
  )}
</AnimatePresence>
```

### Step 8: Add Activity Feed

```tsx
import { ActivityFeed } from "./panel";

// Bottom left corner
<div className="absolute left-4 bottom-4 z-20 w-80">
  <ActivityFeed 
    maxItems={20}
    filter="all"  // or "sessions", "rewards", "errors"
  />
</div>

// Or compact version inside another panel
<ActivityFeedCompact nodeId={selectedNode?.node_id} maxItems={5} />
```

### Step 9: Add Node Comparison

```tsx
import { NodeComparison } from "./panel";

const [comparisonNodes, setComparisonNodes] = useState([]);

const toggleComparison = (node) => {
  setComparisonNodes(prev => 
    prev.find(n => n.id === node.node_id)
      ? prev.filter(n => n.id !== node.node_id)
      : [...prev, {
          id: node.node_id,
          name: node.city || node.country,
          uptime: node.uptime_percent,
          latency: node.latency_ms || 45,
          bandwidth: node.bandwidth_mbps || 850,
          cpu: node.cpu_percent || 35,
          memory: node.memory_percent || 62,
          rewards: node.rewards_24h || 2.45,
        }]
  );
};

// In render:
{comparisonNodes.length > 0 && (
  <div className="absolute left-4 top-24 z-30 w-[500px]">
    <NodeComparison
      nodes={comparisonNodes}
      onRemoveNode={(id) => setComparisonNodes(prev => prev.filter(n => n.id !== id))}
      onClearAll={() => setComparisonNodes([])}
    />
  </div>
)}
```

## Phase 5: Filter Panel ✓

### Step 10: Add Filter Panel

```tsx
import { FilterPanel } from "./filters";

const [filters, setFilters] = useState({
  search: "",
  regions: [],
  statuses: [],
  minUptime: 0,
  maxLatency: 1000,
  minBandwidth: 0,
});

// Filter nodes based on criteria
const filteredNodes = nodes.filter((node) => {
  if (filters.search) {
    const searchLower = filters.search.toLowerCase();
    const matchSearch =
      node.city?.toLowerCase().includes(searchLower) ||
      node.country.toLowerCase().includes(searchLower);
    if (!matchSearch) return false;
  }
  if (filters.regions.length > 0 && !filters.regions.includes(node.region)) {
    return false;
  }
  if (filters.statuses.length > 0) {
    const hasActive = filters.statuses.includes("active") && node.is_active;
    const hasValidator = filters.statuses.includes("validator") && node.is_validator;
    const hasOffline = filters.statuses.includes("offline") && !node.is_active;
    if (!hasActive && !hasValidator && !hasOffline) return false;
  }
  if (node.uptime_percent < filters.minUptime) return false;
  if (node.latency_ms > filters.maxLatency) return false;
  if (node.bandwidth_mbps < filters.minBandwidth) return false;
  return true;
});

// In render:
<div className="absolute top-20 left-4 z-30 w-80">
  <FilterPanel
    filters={filters}
    onFilterChange={setFilters}
    onReset={() => setFilters({
      search: "", regions: [], statuses: [],
      minUptime: 0, maxLatency: 1000, minBandwidth: 0,
    })}
    nodeCount={nodes.length}
    filteredCount={filteredNodes.length}
  />
</div>
```

### Step 11: Add Search Bar (Standalone)

```tsx
import { SearchBar } from "./filters";

<SearchBar
  placeholder="Search nodes, cities, countries..."
  onSearch={(query) => setFilters(prev => ({ ...prev, search: query }))}
  onResultSelect={(result) => {
    // Handle result selection
    console.log("Selected:", result);
  }}
  results={searchResults}  // Optional: pre-populated results
/>
```

### Step 7: Add Node Details Panel

```tsx
import { NodeDetailsPanel } from "./panel";

<AnimatePresence>
  {selectedNode && (
    <NodeDetailsPanel
      node={{
        node_id: selectedNode.node_id,
        city: selectedNode.city,
        country: selectedNode.country,
        region: selectedNode.region,
        is_active: selectedNode.is_active,
        is_validator: selectedNode.is_validator,
        uptime_percent: selectedNode.uptime_percent,
        active_sessions: selectedNode.active_sessions,
        latency_ms: selectedNode.latency_ms || 45,
        bandwidth_mbps: selectedNode.bandwidth_mbps || 850,
        cpu_percent: selectedNode.cpu_percent || 35,
        memory_percent: selectedNode.memory_percent || 62,
        disk_usage_gb: selectedNode.disk_usage_gb || 45,
        total_bandwidth_tb: selectedNode.total_bandwidth_tb || 12.5,
        rewards_24h: selectedNode.rewards_24h || 2.45,
        rewards_total: selectedNode.rewards_total || 156.78,
        first_seen: selectedNode.first_seen,
        last_seen: selectedNode.last_seen,
        version: selectedNode.version || "v2.4.1",
      }}
      onClose={() => setSelectedNode(null)}
    />
  )}
</AnimatePresence>
```

### Step 8: Add Activity Feed

```tsx
import { ActivityFeed } from "./panel";

// Bottom left corner
<div className="absolute left-4 bottom-4 z-20 w-80">
  <ActivityFeed 
    maxItems={20}
    filter="all"  // or "sessions", "rewards", "errors"
  />
</div>

// Or compact version inside another panel
<ActivityFeedCompact nodeId={selectedNode?.node_id} maxItems={5} />
```

### Step 9: Add Node Comparison

```tsx
import { NodeComparison } from "./panel";

const [comparisonNodes, setComparisonNodes] = useState([]);

const toggleComparison = (node) => {
  setComparisonNodes(prev => 
    prev.find(n => n.id === node.node_id)
      ? prev.filter(n => n.id !== node.node_id)
      : [...prev, {
          id: node.node_id,
          name: node.city || node.country,
          uptime: node.uptime_percent,
          latency: node.latency_ms || 45,
          bandwidth: node.bandwidth_mbps || 850,
          cpu: node.cpu_percent || 35,
          memory: node.memory_percent || 62,
          rewards: node.rewards_24h || 2.45,
        }]
  );
};

// In render:
{comparisonNodes.length > 0 && (
  <div className="absolute left-4 top-24 z-30 w-[500px]">
    <NodeComparison
      nodes={comparisonNodes}
      onRemoveNode={(id) => setComparisonNodes(prev => prev.filter(n => n.id !== id))}
      onClearAll={() => setComparisonNodes([])}
    />
  </div>
)}
```

## Complete Example Page

```tsx
"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ThemeProvider, useMapTheme } from "./styles";
import { NodeMarker, GlassPanel, RegionHighlight } from "./components";
import { StatWidget } from "./stats/StatWidget";
import { ConnectionLines, NetworkMesh, ParticleBurst } from "./effects";
import { ThemeToggle } from "./controls";
import { GlobeView } from "./globe";
import { NodeDetailsPanel, ActivityFeed, NodeComparison } from "./panel";
import "./styles/variables.css";

function MapContent() {
  const { theme, themeConfig, is3D } = useMapTheme();
  const [nodes, setNodes] = useState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedRegion, setSelectedRegion] = useState(null);
  const [comparisonNodes, setComparisonNodes] = useState([]);
  const [burst, setBurst] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/v1/explorer/nodes/geo")
      .then(r => r.json())
      .then(data => {
        setNodes(data.nodes);
        setLoading(false);
      });
  }, []);

  const activeNodes = nodes.filter(n => n.is_active);
  const validators = nodes.filter(n => n.is_validator);

  const handleNodeClick = (e: React.MouseEvent, node: any) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setBurst({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setSelectedNode(node);
  };

  const toggleComparison = (node: any) => {
    setComparisonNodes(prev => {
      const exists = prev.find(n => n.id === node.node_id);
      if (exists) {
        return prev.filter(n => n.id !== node.node_id);
      }
      return [...prev, {
        id: node.node_id,
        name: node.city || node.country,
        uptime: node.uptime_percent,
        latency: node.latency_ms || 45,
        bandwidth: node.bandwidth_mbps || 850,
        cpu: node.cpu_percent || 35,
        memory: node.memory_percent || 62,
        rewards: node.rewards_24h || 2.45,
      }];
    });
  };

  const regions = [
    { id: "na", name: "North America", path: "...", center: { x: 20, y: 25 }, nodeCount: 45, activeNodes: 42 },
    { id: "eu", name: "Europe", path: "...", center: { x: 52, y: 22 }, nodeCount: 38, activeNodes: 36 },
    { id: "as", name: "Asia", path: "...", center: { x: 70, y: 28 }, nodeCount: 52, activeNodes: 48 },
  ];

  return (
    <div 
      className="relative w-full h-screen overflow-hidden"
      style={{ background: themeConfig.background }}
    >
      {/* Theme Toggle */}
      <ThemeToggle className="absolute top-4 right-4 z-50" />

      {/* Header Stats */}
      <div className="absolute top-4 left-4 z-20 flex justify-between items-start right-4">
        <div className="flex gap-3">
          <StatWidget label="Total" value={nodes.length} color="cyan" delay={0} />
          <StatWidget label="Active" value={activeNodes.length} color="green" delay={0.1} />
          <StatWidget label="Validators" value={validators.length} color="purple" delay={0.2} />
        </div>
        
        {/* Compare Button */}
        <GlassPanel className="px-4 py-2 flex items-center gap-2">
          <span className="text-white/60 text-sm">
            {comparisonNodes.length} in comparison
          </span>
          {comparisonNodes.length > 0 && (
            <button 
              onClick={() => setComparisonNodes([])}
              className="text-white/40 hover:text-red-400"
            >
              Clear
            </button>
          )}
        </GlassPanel>
      </div>

      {/* Activity Feed */}
      <div className="absolute left-4 bottom-4 z-20 w-80">
        <ActivityFeed maxItems={10} />
      </div>

      {/* 3D Globe or 2D Map */}
      {is3D ? (
        <GlobeView
          nodes={nodes.map(n => ({
            id: n.node_id,
            lat: n.lat,
            lon: n.lon,
            isActive: n.is_active,
            isValidator: n.is_validator,
            city: n.city,
            country: n.country,
          }))}
          selectedNodeId={selectedNode?.node_id}
          onNodeClick={setSelectedNode}
          width={typeof window !== 'undefined' ? window.innerWidth : 800}
          height={typeof window !== 'undefined' ? window.innerHeight : 600}
        />
      ) : (
        <div id="map-container" className="relative w-full h-full">
          <NetworkMesh nodeCount={15} className="opacity-30" />
          
          <ConnectionLines
            nodes={nodes.map(n => ({
              id: n.node_id,
              x: n.lon,
              y: n.lat,
              isValidator: n.is_validator,
              isActive: n.is_active,
            }))}
            showOnlyForSelected={selectedNode?.node_id}
          />
          
          <RegionHighlight
            regions={regions}
            selectedRegion={selectedRegion}
            onRegionClick={setSelectedRegion}
          />
          
          <AnimatePresence>
            {nodes.map((node, index) => (
              <NodeMarker
                key={node.node_id}
                node={node}
                isSelected={selectedNode?.node_id === node.node_id}
                onClick={(e) => handleNodeClick(e, node)}
                index={index}
                mapX={node.x}
                mapY={node.y}
              />
            ))}
          </AnimatePresence>

          <AnimatePresence>
            {burst && (
              <ParticleBurst
                x={burst.x}
                y={burst.y}
                color="#00F5FF"
                onComplete={() => setBurst(null)}
              />
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Node Details Panel */}
      <AnimatePresence>
        {selectedNode && (
          <NodeDetailsPanel
            node={{
              node_id: selectedNode.node_id,
              city: selectedNode.city,
              country: selectedNode.country,
              region: selectedNode.region,
              is_active: selectedNode.is_active,
              is_validator: selectedNode.is_validator,
              uptime_percent: selectedNode.uptime_percent,
              active_sessions: selectedNode.active_sessions,
              latency_ms: selectedNode.latency_ms || 45,
              bandwidth_mbps: selectedNode.bandwidth_mbps || 850,
              cpu_percent: selectedNode.cpu_percent || 35,
              memory_percent: selectedNode.memory_percent || 62,
              disk_usage_gb: selectedNode.disk_usage_gb || 45,
              total_bandwidth_tb: selectedNode.total_bandwidth_tb || 12.5,
              rewards_24h: selectedNode.rewards_24h || 2.45,
              rewards_total: selectedNode.rewards_total || 156.78,
              first_seen: selectedNode.first_seen,
              last_seen: selectedNode.last_seen,
              version: selectedNode.version || "v2.4.1",
            }}
            onClose={() => setSelectedNode(null)}
          />
        )}
      </AnimatePresence>

      {/* Node Comparison */}
      <AnimatePresence>
        {comparisonNodes.length > 0 && (
          <motion.div
            initial={{ opacity: 0, x: -50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -50 }}
            className="absolute left-4 top-24 z-30 w-[500px]"
          >
            <NodeComparison
              nodes={comparisonNodes}
              onRemoveNode={(id) => setComparisonNodes(prev => prev.filter(n => n.id !== id))}
              onClearAll={() => setComparisonNodes([])}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading State */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="text-center">
            <div className="w-12 h-12 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-cyan-400 text-sm">Loading nodes...</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function EnhancedMapPage() {
  return (
    <ThemeProvider defaultTheme="dark">
      <MapContent />
    </ThemeProvider>
  );
}
```

## Visual Improvements Applied

### Phase 1:
1. **Node Markers**: 4-layer design with pulse, halo, core, and center dot
2. **Animations**: Spring physics entry, hover scale, selection glow
3. **Glass Panels**: Backdrop blur with colored glows
4. **Stats**: Animated counters with trend indicators
5. **Tooltips**: Hover info with glassmorphism
6. **Loading**: Custom spinner with neon accent

### Phase 2:
7. **Particle System**: Dynamic particles (upload/download/heartbeat/sparkle)
8. **Connection Lines**: Animated SVG paths with data packets
9. **Network Mesh**: Ambient background mesh effect
10. **Click Burst**: Particle explosion on node click
11. **Gradient Effects**: Multi-color gradients for validators

### Phase 3:
12. **Theme System**: 5 visual themes (dark, light, satellite, cyberpunk, minimal)
13. **Theme Toggle**: Animated UI for theme switching
14. **3D Globe**: Interactive Three.js globe with atmosphere
15. **Region Highlight**: Animated region borders with stats
16. **Responsive**: Adapts to 2D/3D view toggle

### Phase 4:
17. **Node Details Panel**: 3-tab panel with metrics and charts
18. **Performance Charts**: Bandwidth area chart, latency line chart
19. **Activity Feed**: Real-time feed with filtering
20. **Node Comparison**: Radar chart and bar view for comparing nodes
21. **Resource Bars**: Animated CPU/Memory/Disk usage indicators

### Phase 5:
22. **SearchBar**: Animated search with suggestions
23. **FilterPanel**: Collapsible filter UI with sliders
24. **FilterBadge**: Active filter indicators
25. **Presets**: One-click filter presets

## Install Dependencies

```bash
cd apps/web
npm install framer-motion three @react-three/fiber @react-three/drei recharts
```

Then restart your dev server and enjoy the enhanced map! 🎉

## Docker Update

To apply these changes to your Docker environment:

### Quick Update

```powershell
# From project root
.\update-map-docker.ps1 -Environment dev -InstallDeps
```

### Manual Update

```bash
# 1. Install new dependencies
cd apps/web
npm install framer-motion three @react-three/fiber @react-three/drei recharts

# 2. Rebuild web container
cd ../..
docker compose -f docker-compose.dev.yml build --no-cache web

# 3. Restart container
docker compose -f docker-compose.dev.yml up -d web
```

### Verify Update

```bash
# Check container is running
docker compose ps web

# View logs
docker compose logs -f web
```

Access the enhanced map at: `http://localhost:3000/explorer/map`

See `DOCKER_MAP_UPDATE.md` for detailed instructions.

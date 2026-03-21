# Node Map Enhancement Components

## Installation

Install required dependencies:

```bash
npm install framer-motion
npm install three @react-three/fiber @react-three/drei  # For 3D globe
npm install recharts  # For charts in details panel
```

## Components

### 1. NodeMarker

Enhanced node marker with multi-layer design, animations, and particle effects.

```tsx
import { NodeMarker } from "./components/NodeMarker";

<NodeMarker
  node={{
    node_id: "abc123",
    lat: 5.6037,
    lon: -0.1870,
    is_active: true,
    is_validator: false,
    uptime_percent: 99.9,
    active_sessions: 12,
    country: "GH",
    region: "africa",
    city: "Accra",
  }}
  isSelected={false}
  onClick={() => handleNodeClick(node)}
  index={0}
  mapX={nodeX}  // Absolute X position for particle effects
  mapY={nodeY}  // Absolute Y position for particle effects
/>
```

**Features:**
- 4-layer animated marker design
- Pulse animation for active nodes
- Rotating halo ring
- Hover tooltip with node info
- Selection glow effect
- Status-based colors (cyan=active, purple=validator, red=offline)
- **Particle effects** on active nodes
- **Click burst animation**

### 2. GlassPanel

Reusable glassmorphism container.

```tsx
import { GlassPanel } from "./components/GlassPanel";

<GlassPanel
  glowColor="cyan"
  intensity="medium"
  className="p-6"
>
  <h2>Panel Content</h2>
</GlassPanel>
```

**Props:**
- `glowColor`: "cyan" | "purple" | "pink" | "none"
- `intensity`: "light" | "medium" | "heavy"
- `className`: Additional CSS classes

### 3. StatWidget

Animated statistics card with counter.

```tsx
import { StatWidget } from "./stats/StatWidget";

<StatWidget
  label="Active Nodes"
  value={128}
  trend="up"
  trendValue="12%"
  color="cyan"
  delay={0.2}
/>
```

**Features:**
- Animated number counting
- Trend indicators (up/down/neutral)
- Color-coded (cyan, purple, green, yellow)
- Hover glow effect
- Entry animation

### 4. ParticleSystem (Phase 2)

Dynamic particle effects around active nodes.

```tsx
import { ParticleSystem } from "./effects";

<ParticleSystem
  nodeId={node.node_id}
  isActive={node.is_active}
  isValidator={node.is_validator}
  intensity="medium"  // "low" | "medium" | "high"
  centerX={100}
  centerY={100}
/>
```

**Particle Types:**
- `upload` - Cyan particles floating upward (data upload)
- `download` - Green particles floating downward (data download)
- `heartbeat` - Yellow pulsing dots (node health)
- `sparkle` - Purple twinkling stars (validator nodes)

### 5. ParticleBurst

Click feedback effect with particles exploding from click point.

```tsx
import { ParticleBurst } from "./effects";

<ParticleBurst
  x={clickX}
  y={clickY}
  color="#00F5FF"
  onComplete={() => setShowBurst(false)}
/>
```

### 6. ConnectionLines (Phase 2)

Animated SVG connection lines between nearby nodes.

```tsx
import { ConnectionLines } from "./effects";

<ConnectionLines
  nodes={nodes}
  maxConnections={3}
  connectionDistance={200}
  showOnlyForSelected={selectedNodeId}  // Optional: show only for selected
/>
```

**Features:**
- Curved bezier paths between nodes
- Animated data packets traveling along lines
- Strength-based opacity
- Gradient effects for validator connections
- Dashed animation for regular nodes

### 7. NetworkMesh

Ambient background mesh effect for the entire map.

```tsx
import { NetworkMesh } from "./effects";

<NetworkMesh nodeCount={20} />
```

## Phase 3: Map Visual Styles

### ThemeProvider & useMapTheme

Manage map themes across your application.

```tsx
import { ThemeProvider } from "./styles";

// Wrap your app
<ThemeProvider defaultTheme="dark">
  <YourMapComponent />
</ThemeProvider>

// Use in components
import { useMapTheme } from "./styles";

const { theme, themeConfig, setTheme, is3D, setIs3D } = useMapTheme();
```

### ThemeToggle

Switch between visual themes with animated UI.

```tsx
import { ThemeToggle } from "./controls";

<ThemeToggle className="absolute top-4 right-4" />
```

**Available Themes:**
- `dark` - Default cyberpunk dark (cyan accents)
- `light` - Clean light theme
- `satellite` - Satellite imagery style
- `cyberpunk` - Neon pink/purple theme
- `minimal` - Minimalist black/white

### GlobeView (3D)

Interactive 3D globe with node markers.

```tsx
import { GlobeView } from "./globe";

<GlobeView
  nodes={nodes}
  selectedNodeId={selectedNode?.id}
  onNodeClick={handleNodeClick}
  width={800}
  height={600}
/>
```

**React 19 Note:** The default export uses `react-globe.gl` which is compatible with React 19. 
For the full Three.js version (React 18 only), install `three @react-three/fiber @react-three/drei` 
and import from `globe/GlobeView.tsx` directly.

**Features:**
- Interactive rotation and zoom
- Animated atmosphere glow
- Star field background
- Node markers with tooltips
- Connection arcs between nodes
- Auto-rotation

### RegionHighlight

Animated region borders and overlays.

```tsx
import { RegionHighlight, RegionPulse, HeatmapOverlay } from "./components";

// Full region borders
<RegionHighlight
  regions={[
    { id: "na", name: "North America", path: "...", center: {x: 20, y: 25}, nodeCount: 45, activeNodes: 42 },
    // ...
  ]}
  selectedRegion={selectedRegion}
  onRegionClick={handleRegionClick}
/>

// Pulse effect for active regions
<RegionPulse 
  regions={[{ id: "1", x: 50, y: 30, intensity: 0.8 }]} 
/>

// Heat map overlay
<HeatmapOverlay 
  data={[{ x: 50, y: 50, value: 80 }]} 
  maxValue={100} 
/>
```

## Phase 4: Details Panel

### NodeDetailsPanel

Comprehensive node information with tabs, charts, and metrics.

```tsx
import { NodeDetailsPanel } from "./panel";

<NodeDetailsPanel
  node={{
    node_id: "...",
    city: "Accra",
    country: "Ghana",
    is_active: true,
    is_validator: true,
    uptime_percent: 99.8,
    active_sessions: 24,
    latency_ms: 45,
    bandwidth_mbps: 850,
    cpu_percent: 35,
    memory_percent: 62,
    disk_usage_gb: 45,
    total_bandwidth_tb: 12.5,
    rewards_24h: 2.45,
    rewards_total: 156.78,
    first_seen: "2024-01-15",
    last_seen: "2024-01-20",
    version: "v2.4.1",
  }}
  onClose={() => setSelectedNode(null)}
  historicalData={bandwidthData}  // Optional: 24h bandwidth data
  latencyData={latencyData}       // Optional: 24h latency data
/>
```

**Panel Tabs:**
1. **Overview** - Quick stats, resource usage bars, version info
2. **Performance** - Bandwidth area chart, latency line chart
3. **Rewards** - 24h/total rewards, activity timeline

### ActivityFeed

Real-time activity feed with filtering and auto-updates.

```tsx
import { ActivityFeed, ActivityFeedCompact } from "./panel";

// Full feed with controls
<ActivityFeed 
  maxItems={50}
  filter="all"  // "all" | "sessions" | "rewards" | "errors"
  nodeId={selectedNode?.node_id}  // Optional: filter by node
/>

// Compact version for embedding
<ActivityFeedCompact nodeId={nodeId} maxItems={5} />
```

**Event Types:**
- `session_start` / `session_end` - Connection events
- `bandwidth` - Data transfer milestones
- `reward` - Token rewards
- `status_change` - Online/offline transitions
- `error` - Error notifications

### NodeComparison

Compare metrics between multiple nodes with radar charts.

```tsx
import { NodeComparison } from "./panel";

<NodeComparison
  nodes={[
    { id: "1", name: "New York", uptime: 99.9, latency: 25, bandwidth: 950, cpu: 45, memory: 60, rewards: 3.2 },
    { id: "2", name: "London", uptime: 99.7, latency: 35, bandwidth: 800, cpu: 38, memory: 55, rewards: 2.8 },
  ]}
  onRemoveNode={(id) => removeFromComparison(id)}
  onClearAll={() => clearComparison()}
/>
```

**View Modes:**
- `radar` - Radar chart showing 6 metrics
- `bars` - Side-by-side bar comparison

## Phase 5: Filter Panel

### SearchBar

Animated search with real-time suggestions.

```tsx
import { SearchBar } from "./filters";

<SearchBar
  placeholder="Search nodes, cities, countries..."
  onSearch={(query) => handleSearch(query)}
  onResultSelect={(result) => handleSelect(result)}
  results={searchResults}
/>
```

**Features:**
- Debounced search (300ms)
- Keyboard shortcut (Ctrl+K)
- Type icons (node, city, country, region)
- Animated focus states
- Clear button

### FilterPanel

Comprehensive filtering with collapsible UI.

```tsx
import { FilterPanel } from "./filters";

<FilterPanel
  filters={{
    search: "",
    regions: ["north_america", "europe"],
    statuses: ["active", "validator"],
    minUptime: 95,
    maxLatency: 100,
    minBandwidth: 500,
  }}
  onFilterChange={(newFilters) => setFilters(newFilters)}
  onReset={() => resetFilters()}
  nodeCount={100}
  filteredCount={45}
/>
```

**Filter Types:**
- **Search** - Text search across node fields
- **Regions** - Multi-select geographic regions
- **Status** - Active, Validator, Offline toggles
- **Performance** - Sliders for uptime, latency, bandwidth

### FilterBadge & NodeCountBadge

Show active filter state.

```tsx
import { FilterBadge, NodeCountBadge, FilterPresets } from "./filters";

// Active filter indicator
<FilterBadge
  count={3}
  onClick={() => openFilterPanel()}
  onClear={() => clearAllFilters()}
/>

// Node count with progress bar
<NodeCountBadge total={100} filtered={45} />

// Quick preset buttons
<FilterPresets onSelectPreset={(preset) => applyPreset(preset)} />
```

**Presets:** `all`, `active`, `validators`, `high_perf`, `my_region`

## Phase 6: Final Polish

### PageTransition

Smooth transitions between views.

```tsx
import { PageTransition, StaggerContainer, StaggerItem, ViewSwitcher } from "./transitions";

// Page transition with fade/slide/scale/glitch
<PageTransition mode="fade" duration={0.3}>
  <YourContent />
</PageTransition>

// Staggered list animation
<StaggerContainer staggerDelay={0.05}>
  {items.map(item => (
    <StaggerItem key={item.id}>
      <Card {...item} />
    </StaggerItem>
  ))}
</StaggerContainer>

// 2D/3D view switcher
<ViewSwitcher
  is3D={is3D}
  view2D={<Map2D />}
  view3D={<Globe3D />}
/>
```

### Skeleton Loaders

Loading states for better perceived performance.

```tsx
import { 
  Skeleton, 
  CardSkeleton, 
  StatSkeleton, 
  MapLoadingOverlay,
  PageLoader 
} from "./loading";

// Generic skeleton
<Skeleton width="100%" height="1rem" rounded="md" />

// Pre-built skeletons
<CardSkeleton lines={3} hasImage />
<StatSkeleton count={4} />
<MapLoadingOverlay progress={66} message="Loading nodes..." />
<PageLoader />
```

### Error Boundaries

Graceful error handling.

```tsx
import { ErrorBoundary, APIError, NetworkStatus } from "./error";

// Wrap components
<ErrorBoundary 
  fallback={<CustomError />}
  onReset={() => resetState()}
>
  <YourComponent />
</ErrorBoundary>

// API error display
<APIError statusCode={500} onRetry={() => retry()} />

// Network status indicator
<NetworkStatus />
```

### Accessibility

ARIA labels, keyboard navigation, focus management.

```tsx
import { 
  LiveRegionProvider, 
  useAnnouncement,
  SkipLink,
  FocusTrap,
  useKeyboardShortcut,
  useReducedMotion 
} from "./accessibility";

// Announce to screen readers
const { announce } = useAnnouncement();
announce("Node selected", "polite");

// Keyboard shortcuts
useKeyboardShortcut("k", () => openSearch(), { ctrl: true });

// Skip link for keyboard users
<SkipLink targetId="main-content" />

// Focus trap for modals
<FocusTrap isActive={isOpen} onEscape={() => close()}>
  <Modal />
</FocusTrap>

// Respect reduced motion
const prefersReducedMotion = useReducedMotion();
```

### Performance Utils

Optimizations for smooth 60fps.

```tsx
import { 
  debounce, 
  throttle,
  useIntersectionObserver,
  useVisibilityState,
  usePerformanceMetrics 
} from "./utils";

// Debounced search
const debouncedSearch = debounce((q) => search(q), 300);

// Visibility state (pause when tab hidden)
const isVisible = useVisibilityState();

// Performance metrics
const { fps, memory, nodes } = usePerformanceMetrics();

// Lazy load components
const [ref, isInView] = useIntersectionObserver({ threshold: 0.1 });
<div ref={ref}>{isInView && <HeavyComponent />}</div>
```

## Design System

### Colors

```css
--neon-cyan: #00F5FF
--neon-purple: #B24DFF
--neon-pink: #FF2D9E
--neon-green: #39FF14
--neon-red: #FF4444
--neon-yellow: #FFD700
```

### Complete Map Page Example

```tsx
"use client";

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
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedRegion, setSelectedRegion] = useState(null);
  const [comparisonNodes, setComparisonNodes] = useState([]);
  const [burst, setBurst] = useState(null);
  const [nodes, setNodes] = useState([]);

  const handleNodeClick = (e, node) => {
    setBurst({ x: e.clientX, y: e.clientY });
    setSelectedNode(node);
  };

  const toggleComparison = (node) => {
    setComparisonNodes(prev => 
      prev.find(n => n.id === node.node_id)
        ? prev.filter(n => n.id !== node.node_id)
        : [...prev, { id: node.node_id, name: node.city, uptime: node.uptime_percent, ... }]
    );
  };

  return (
    <div 
      className="relative w-full h-screen overflow-hidden"
      style={{ background: themeConfig.background }}
    >
      {/* Theme Toggle */}
      <ThemeToggle className="absolute top-4 right-4 z-50" />

      {/* Stats Header */}
      <div className="absolute top-4 left-4 z-20 flex gap-3">
        <StatWidget label="Total" value={nodes.length} color="cyan" />
        <StatWidget label="Active" value={activeCount} color="green" />
        <StatWidget label="Validators" value={validatorCount} color="purple" />
      </div>

      {/* Activity Feed */}
      <div className="absolute left-4 bottom-4 z-20 w-80">
        <ActivityFeed maxItems={10} />
      </div>

      {/* 3D Globe or 2D Map */}
      {is3D ? (
        <GlobeView
          nodes={nodes}
          selectedNodeId={selectedNode?.node_id}
          onNodeClick={setSelectedNode}
          width={window.innerWidth}
          height={window.innerHeight}
        />
      ) : (
        <div id="map-container" className="relative w-full h-full">
          <NetworkMesh nodeCount={15} className="opacity-30" />
          
          <ConnectionLines
            nodes={nodes}
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
            node={selectedNode}
            onClose={() => setSelectedNode(null)}
          />
        )}
      </AnimatePresence>

      {/* Node Comparison */}
      {comparisonNodes.length > 0 && (
        <div className="absolute left-4 top-24 z-30 w-[500px]">
          <NodeComparison
            nodes={comparisonNodes}
            onRemoveNode={(id) => setComparisonNodes(prev => prev.filter(n => n.id !== id))}
            onClearAll={() => setComparisonNodes([])}
          />
        </div>
      )}
    </div>
  );
}

export default function MapPage() {
  return (
    <ThemeProvider defaultTheme="dark">
      <MapContent />
    </ThemeProvider>
  );
}
```

## Animation Variants

Located in `components/NodeMarker/MarkerAnimations.ts`:

- `nodeEntryVariants` - Entry animation with spring physics
- `pulseRingVariants` - Continuous pulse for active nodes
- `haloRingVariants` - Rotating gradient ring
- `markerHoverVariants` - Hover scale effect
- `selectionVariants` - Selected state with glow
- `tooltipVariants` - Tooltip appear/disappear

## Implementation Phases

- [x] Phase 1: Design System + Base Components (NodeMarker, GlassPanel, StatWidget)
- [x] Phase 2: Particle Effects + Connection Lines
- [x] Phase 3: Map Visual Styles (Themes, 3D Globe, Regions)
- [x] Phase 4: Details Panel (NodeDetailsPanel, ActivityFeed, NodeComparison)
- [x] Phase 5: Filter Panel (SearchBar, FilterPanel, FilterBadge, Presets)
- [x] Phase 6: Final Polish (Transitions, Skeletons, Error Boundaries, A11y, Performance)

## File Structure

```
map/
├── components/
│   ├── NodeMarker/
│   │   ├── index.tsx
│   │   └── MarkerAnimations.ts
│   ├── GlassPanel.tsx
│   ├── RegionHighlight.tsx
│   └── index.ts
├── controls/
│   ├── ThemeToggle.tsx
│   └── index.ts
├── effects/
│   ├── ParticleSystem.tsx
│   ├── ConnectionLines.tsx
│   └── index.ts
├── globe/
│   ├── GlobeView.tsx
│   └── index.ts
├── panel/
│   ├── NodeDetailsPanel.tsx
│   ├── ActivityFeed.tsx
│   ├── NodeComparison.tsx
│   └── index.ts
├── filters/
│   ├── SearchBar.tsx
│   ├── FilterPanel.tsx
│   ├── FilterBadge.tsx
│   └── index.ts
├── stats/
│   └── StatWidget.tsx
├── styles/
│   ├── variables.css
│   ├── MapThemes.ts
│   ├── ThemeProvider.tsx
│   └── index.ts
├── transitions/
│   ├── PageTransition.tsx
│   └── index.ts
├── loading/
│   ├── SkeletonLoaders.tsx
│   └── index.ts
├── error/
│   ├── ErrorBoundary.tsx
│   └── index.ts
├── accessibility/
│   ├── ARIA.tsx
│   └── index.ts
├── utils/
│   ├── performance.ts
│   └── index.ts
├── examples/
│   ├── EffectsDemo.tsx
│   ├── ThemeDemo.tsx
│   ├── PanelDemo.tsx
│   ├── FilterDemo.tsx
│   └── FinalDemo.tsx
├── README.md
└── INTEGRATION_GUIDE.md
```

## Demo Pages

Import and use the demo pages to see components in action:

```tsx
import EffectsDemo from "./examples/EffectsDemo";    // Phase 2: Particles & Connections
import ThemeDemo from "./examples/ThemeDemo";        // Phase 3: Themes & 3D Globe
import PanelDemo from "./examples/PanelDemo";        // Phase 4: Details Panel
import FilterDemo from "./examples/FilterDemo";      // Phase 5: Filters & Search
```

## 🎉 All Phases Complete!

### Implementation Checklist

- [x] Phase 1: Design System + Base Components
- [x] Phase 2: Particle Effects + Connection Lines  
- [x] Phase 3: Map Visual Styles
- [x] Phase 4: Details Panel
- [x] Phase 5: Filter Panel
- [x] Phase 6: Final Polish

### Integration Steps

1. **Install dependencies:**
   ```bash
   npm install framer-motion three @react-three/fiber @react-three/drei recharts
   ```

2. **Copy components** to your project

3. **Wrap app with providers:**
   ```tsx
   <ThemeProvider>
     <LiveRegionProvider>
       <YourApp />
     </LiveRegionProvider>
   </ThemeProvider>
   ```

4. **Import and use components** as needed

5. **Test with demo pages** before integration

### Demo Pages

```tsx
import EffectsDemo from "./examples/EffectsDemo";    // Phase 2: Particles
import ThemeDemo from "./examples/ThemeDemo";        // Phase 3: Themes
import PanelDemo from "./examples/PanelDemo";        // Phase 4: Details
import FilterDemo from "./examples/FilterDemo";      // Phase 5: Filters
import FinalDemo from "./examples/FinalDemo";        // Phase 6: Polish
```

### Performance Tips

- Use `useMemo` for expensive calculations
- Wrap components with `React.memo` where appropriate
- Use `useCallback` for event handlers passed to children
- Lazy load heavy components (3D globe, charts)
- Monitor FPS with `usePerformanceMetrics`
- Respect `prefers-reduced-motion`

### Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile browsers with ES6+ support

"use client";

/**
 * Phase 5 Demo: Filter Panel
 * Search, filters, and presets
 */

import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ThemeProvider } from "../styles";
import { GlassPanel } from "../components/GlassPanel";
import { StatWidget } from "../stats/StatWidget";
import { SearchBar, FilterPanel, FilterBadge, NodeCountBadge, FilterPresets } from "../filters";
import { NodeMarker } from "../components";

// Mock nodes for filtering
const mockNodes = [
  { node_id: "1", lat: 40.7128, lon: -74.0060, city: "New York", country: "USA", region: "north_america", is_active: true, is_validator: true, uptime_percent: 99.9, latency_ms: 25, bandwidth_mbps: 950 },
  { node_id: "2", lat: 51.5074, lon: -0.1278, city: "London", country: "UK", region: "europe", is_active: true, is_validator: false, uptime_percent: 99.7, latency_ms: 35, bandwidth_mbps: 800 },
  { node_id: "3", lat: 35.6762, lon: 139.6503, city: "Tokyo", country: "Japan", region: "asia", is_active: true, is_validator: true, uptime_percent: 99.8, latency_ms: 55, bandwidth_mbps: 900 },
  { node_id: "4", lat: -33.8688, lon: 151.2093, city: "Sydney", country: "Australia", region: "oceania", is_active: true, is_validator: false, uptime_percent: 99.5, latency_ms: 65, bandwidth_mbps: 750 },
  { node_id: "5", lat: 5.6037, lon: -0.1870, city: "Accra", country: "Ghana", region: "africa", is_active: false, is_validator: false, uptime_percent: 85.2, latency_ms: 120, bandwidth_mbps: 300 },
  { node_id: "6", lat: -23.5505, lon: -46.6333, city: "Sao Paulo", country: "Brazil", region: "south_america", is_active: true, is_validator: false, uptime_percent: 98.5, latency_ms: 85, bandwidth_mbps: 600 },
  { node_id: "7", lat: 52.5200, lon: 13.4050, city: "Berlin", country: "Germany", region: "europe", is_active: true, is_validator: true, uptime_percent: 99.9, latency_ms: 30, bandwidth_mbps: 920 },
  { node_id: "8", lat: 1.3521, lon: 103.8198, city: "Singapore", country: "Singapore", region: "asia", is_active: true, is_validator: false, uptime_percent: 99.6, latency_ms: 40, bandwidth_mbps: 880 },
  { node_id: "9", lat: 37.7749, lon: -122.4194, city: "San Francisco", country: "USA", region: "north_america", is_active: false, is_validator: false, uptime_percent: 78.3, latency_ms: 45, bandwidth_mbps: 500 },
  { node_id: "10", lat: -26.2041, lon: 28.0473, city: "Johannesburg", country: "South Africa", region: "africa", is_active: true, is_validator: false, uptime_percent: 96.2, latency_ms: 95, bandwidth_mbps: 450 },
];

// Default filter state
const defaultFilters = {
  search: "",
  regions: [] as string[],
  statuses: [] as ("active" | "validator" | "offline")[],
  minUptime: 0,
  maxLatency: 1000,
  minBandwidth: 0,
};

function DemoContent() {
  const [filters, setFilters] = useState(defaultFilters);
  const [showFilterPanel, setShowFilterPanel] = useState(false);

  // Filter nodes based on criteria
  const filteredNodes = useMemo(() => {
    return mockNodes.filter((node) => {
      // Search filter
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        const matchSearch =
          node.city?.toLowerCase().includes(searchLower) ||
          node.country.toLowerCase().includes(searchLower) ||
          node.node_id.toLowerCase().includes(searchLower);
        if (!matchSearch) return false;
      }

      // Region filter
      if (filters.regions.length > 0 && !filters.regions.includes(node.region)) {
        return false;
      }

      // Status filter
      if (filters.statuses.length > 0) {
        const hasActive = filters.statuses.includes("active") && node.is_active;
        const hasValidator = filters.statuses.includes("validator") && node.is_validator;
        const hasOffline = filters.statuses.includes("offline") && !node.is_active;
        if (!hasActive && !hasValidator && !hasOffline) return false;
      }

      // Performance filters
      if (node.uptime_percent < filters.minUptime) return false;
      if (node.latency_ms > filters.maxLatency) return false;
      if (node.bandwidth_mbps < filters.minBandwidth) return false;

      return true;
    });
  }, [filters]);

  // Count active filters
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.search) count++;
    count += filters.regions.length;
    count += filters.statuses.length;
    if (filters.minUptime > 0) count++;
    if (filters.maxLatency < 1000) count++;
    if (filters.minBandwidth > 0) count++;
    return count;
  }, [filters]);

  // Handle preset selection
  const handlePreset = (preset: string) => {
    switch (preset) {
      case "all":
        setFilters(defaultFilters);
        break;
      case "active":
        setFilters({ ...defaultFilters, statuses: ["active"] });
        break;
      case "validators":
        setFilters({ ...defaultFilters, statuses: ["validator"] });
        break;
      case "high_perf":
        setFilters({
          ...defaultFilters,
          minUptime: 99,
          maxLatency: 50,
          minBandwidth: 800,
        });
        break;
      case "my_region":
        setFilters({ ...defaultFilters, regions: ["north_america"] });
        break;
    }
  };

  // Search results for demo
  const searchResults = [
    { id: "1", type: "city" as const, name: "New York", subtitle: "USA" },
    { id: "2", type: "city" as const, name: "London", subtitle: "UK" },
    { id: "3", type: "country" as const, name: "USA", subtitle: "3 nodes" },
  ];

  return (
    <div className="min-h-screen bg-[#050508] p-8">
      <h1 className="text-3xl font-bold text-white mb-2">Phase 5: Filter Panel</h1>
      <p className="text-white/60 mb-8">Search, filter, and find nodes with animated UI</p>

      {/* Stats */}
      <div className="flex gap-4 mb-8">
        <StatWidget label="Total Nodes" value={mockNodes.length} color="cyan" />
        <StatWidget label="Filtered" value={filteredNodes.length} color="purple" />
        <StatWidget label="Active Filters" value={activeFilterCount} color="yellow" />
        <StatWidget label="Validators" value={mockNodes.filter(n => n.is_validator).length} color="green" />
      </div>

      <div className="grid grid-cols-3 gap-8">
        {/* Left Column - Filter Controls */}
        <div className="space-y-6">
          {/* Search Bar Demo */}
          <GlassPanel className="p-6">
            <h3 className="text-white font-semibold mb-4">🔍 Search Bar</h3>
            <SearchBar
              placeholder="Search nodes, cities..."
              results={searchResults}
              onSearch={(q) => console.log("Search:", q)}
              onResultSelect={(r) => console.log("Selected:", r)}
            />
            <p className="text-white/40 text-xs mt-3">
              Type to see suggestions • Supports keyboard navigation
            </p>
          </GlassPanel>

          {/* Filter Panel */}
          <FilterPanel
            filters={filters}
            onFilterChange={setFilters}
            onReset={() => setFilters(defaultFilters)}
            nodeCount={mockNodes.length}
            filteredCount={filteredNodes.length}
          />

          {/* Presets */}
          <GlassPanel className="p-4">
            <h3 className="text-white/60 text-sm mb-3">Quick Presets</h3>
            <FilterPresets onSelectPreset={handlePreset} />
          </GlassPanel>
        </div>

        {/* Middle Column - Results */}
        <div className="col-span-2">
          <GlassPanel className="p-6 h-full" intensity="heavy">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-white font-semibold">Filtered Results</h3>
              <NodeCountBadge total={mockNodes.length} filtered={filteredNodes.length} />
            </div>

            {/* Active Filter Badges */}
            {activeFilterCount > 0 && (
              <div className="mb-6">
                <FilterBadge
                  count={activeFilterCount}
                  onClick={() => setShowFilterPanel(true)}
                  onClear={() => setFilters(defaultFilters)}
                />
              </div>
            )}

            {/* Node Grid */}
            <div className="grid grid-cols-2 gap-4">
              <AnimatePresence mode="popLayout">
                {filteredNodes.map((node, index) => (
                  <motion.div
                    key={node.node_id}
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ delay: index * 0.05 }}
                    className="p-4 rounded-lg bg-white/5 border border-white/10 hover:border-cyan-500/30 transition-colors"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h4 className="text-white font-medium">{node.city}</h4>
                        <p className="text-white/40 text-sm">{node.country}</p>
                      </div>
                      <div className="flex gap-1">
                        {node.is_validator && (
                          <span className="px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400 text-xs">
                            ★
                          </span>
                        )}
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs ${
                            node.is_active
                              ? "bg-green-500/20 text-green-400"
                              : "bg-red-500/20 text-red-400"
                          }`}
                        >
                          {node.is_active ? "●" : "○"}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div className="text-center p-2 rounded bg-white/5">
                        <div className="text-white/40">Uptime</div>
                        <div className="text-cyan-400 font-medium">{node.uptime_percent}%</div>
                      </div>
                      <div className="text-center p-2 rounded bg-white/5">
                        <div className="text-white/40">Latency</div>
                        <div className="text-yellow-400 font-medium">{node.latency_ms}ms</div>
                      </div>
                      <div className="text-center p-2 rounded bg-white/5">
                        <div className="text-white/40">Bandwidth</div>
                        <div className="text-purple-400 font-medium">{node.bandwidth_mbps}</div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            {filteredNodes.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-white/40">
                <span className="text-4xl mb-4">🔍</span>
                <p className="text-lg">No nodes match your filters</p>
                <button
                  onClick={() => setFilters(defaultFilters)}
                  className="mt-4 px-4 py-2 rounded-lg bg-cyan-500/20 text-cyan-400 text-sm hover:bg-cyan-500/30 transition-colors"
                >
                  Clear Filters
                </button>
              </div>
            )}
          </GlassPanel>
        </div>
      </div>

      {/* Features Grid */}
      <div className="grid grid-cols-4 gap-6 mt-8">
        <GlassPanel className="p-6">
          <h3 className="text-cyan-400 font-semibold mb-3">🔍 Smart Search</h3>
          <ul className="text-white/70 text-sm space-y-2">
            <li>• Real-time suggestions</li>
            <li>• Multi-field search</li>
            <li>• Keyboard shortcuts (Ctrl+K)</li>
            <li>• Type icons</li>
          </ul>
        </GlassPanel>

        <GlassPanel className="p-6">
          <h3 className="text-purple-400 font-semibold mb-3">🎛️ Rich Filters</h3>
          <ul className="text-white/70 text-sm space-y-2">
            <li>• Region selection</li>
            <li>• Status toggles</li>
            <li>• Performance sliders</li>
            <li>• Animated UI</li>
          </ul>
        </GlassPanel>

        <GlassPanel className="p-6">
          <h3 className="text-green-400 font-semibold mb-3">🏷️ Filter Chips</h3>
          <ul className="text-white/70 text-sm space-y-2">
            <li>• Active filter display</li>
            <li>• One-click removal</li>
            <li>• Color coding</li>
            <li>• Collapsible panel</li>
          </ul>
        </GlassPanel>

        <GlassPanel className="p-6">
          <h3 className="text-yellow-400 font-semibold mb-3">⚡ Quick Presets</h3>
          <ul className="text-white/70 text-sm space-y-2">
            <li>• All nodes</li>
            <li>• Active only</li>
            <li>• Validators</li>
            <li>• High performance</li>
          </ul>
        </GlassPanel>
      </div>
    </div>
  );
}

export default function FilterDemo() {
  return (
    <ThemeProvider defaultTheme="dark">
      <DemoContent />
    </ThemeProvider>
  );
}

"use client";

/**
 * Phase 4 Demo: Details Panel, Activity Feed, Node Comparison
 */

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ThemeProvider } from "../styles";
import { GlassPanel } from "../components/GlassPanel";
import { NodeDetailsPanel, ActivityFeed, ActivityFeedCompact, NodeComparison } from "../panel";
import { StatWidget } from "../stats/StatWidget";

// Mock node data
const mockNode = {
  node_id: "a55ea586-24bd-4456-9651-162ae0aa50fe",
  city: "Accra",
  country: "Ghana",
  region: "Africa",
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
  first_seen: "2024-01-15T00:00:00Z",
  last_seen: new Date().toISOString(),
  version: "v2.4.1",
};

// Mock nodes for comparison
const mockNodesForComparison = [
  { id: "1", name: "New York", uptime: 99.9, latency: 25, bandwidth: 950, cpu: 45, memory: 60, rewards: 3.2 },
  { id: "2", name: "London", uptime: 99.7, latency: 35, bandwidth: 800, cpu: 38, memory: 55, rewards: 2.8 },
  { id: "3", name: "Tokyo", uptime: 99.8, latency: 55, bandwidth: 900, cpu: 42, memory: 65, rewards: 3.1 },
];

function DemoContent() {
  const [showDetails, setShowDetails] = useState(true);
  const [selectedNodes, setSelectedNodes] = useState<string[]>(["1", "2"]);
  const [activeDemo, setActiveDemo] = useState<"details" | "activity" | "compare">("details");

  const toggleNode = (id: string) => {
    setSelectedNodes(prev => 
      prev.includes(id) 
        ? prev.filter(n => n !== id)
        : [...prev, id]
    );
  };

  const comparisonNodes = mockNodesForComparison.filter(n => selectedNodes.includes(n.id));

  return (
    <div className="min-h-screen bg-[#050508] p-8">
      <h1 className="text-3xl font-bold text-white mb-2">Phase 4: Details Panel</h1>
      <p className="text-white/60 mb-8">Comprehensive node information with charts, activity feeds, and comparison tools</p>

      {/* Stats */}
      <div className="flex gap-4 mb-8">
        <StatWidget label="Total Nodes" value={156} trend="up" trendValue="12%" color="cyan" />
        <StatWidget label="Active Sessions" value={1248} color="green" />
        <StatWidget label="24h Rewards" value={342.5} suffix=" PRXY" color="purple" />
        <StatWidget label="Total Data" value={45.2} suffix=" TB" color="yellow" />
      </div>

      {/* Demo Controls */}
      <GlassPanel className="mb-8 p-4">
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            <button
              onClick={() => setActiveDemo("details")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeDemo === "details"
                  ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                  : "text-white/60 hover:text-white hover:bg-white/5"
              }`}
            >
              📊 Node Details Panel
            </button>
            <button
              onClick={() => setActiveDemo("activity")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeDemo === "activity"
                  ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                  : "text-white/60 hover:text-white hover:bg-white/5"
              }`}
            >
              📡 Activity Feed
            </button>
            <button
              onClick={() => setActiveDemo("compare")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeDemo === "compare"
                  ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                  : "text-white/60 hover:text-white hover:bg-white/5"
              }`}
            >
              ⚖️ Node Comparison
            </button>
          </div>
        </div>
      </GlassPanel>

      {/* Demo Content */}
      <div className="relative min-h-[600px]">
        <AnimatePresence mode="wait">
          {activeDemo === "details" && (
            <motion.div
              key="details"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex gap-6"
            >
              {/* Left side - Controls */}
              <div className="w-80 space-y-4">
                <GlassPanel className="p-4">
                  <h3 className="text-white font-semibold mb-4">Panel Controls</h3>
                  <button
                    onClick={() => setShowDetails(!showDetails)}
                    className="w-full py-2 px-4 rounded-lg bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30 transition-colors"
                  >
                    {showDetails ? "Hide Details Panel" : "Show Details Panel"}
                  </button>
                </GlassPanel>

                <GlassPanel className="p-4">
                  <h3 className="text-white font-semibold mb-3">Features</h3>
                  <ul className="space-y-2 text-sm text-white/70">
                    <li className="flex items-center gap-2">
                      <span className="text-green-400">✓</span>
                      3-tab navigation (Overview/Performance/Rewards)
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-green-400">✓</span>
                      Animated metric cards
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-green-400">✓</span>
                      Resource usage progress bars
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-green-400">✓</span>
                      Bandwidth area chart (24h)
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-green-400">✓</span>
                      Latency line chart
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-green-400">✓</span>
                      Activity timeline
                    </li>
                  </ul>
                </GlassPanel>

                <GlassPanel className="p-4">
                  <h3 className="text-white font-semibold mb-3">Compact Activity</h3>
                  <ActivityFeedCompact maxItems={3} />
                </GlassPanel>
              </div>

              {/* Right side - Panel */}
              <div className="flex-1 relative">
                <AnimatePresence>
                  {showDetails && (
                    <NodeDetailsPanel
                      node={mockNode}
                      onClose={() => setShowDetails(false)}
                    />
                  )}
                </AnimatePresence>

                {!showDetails && (
                  <div className="flex items-center justify-center h-64 text-white/40">
                    <p>Click "Show Details Panel" to see the demo</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {activeDemo === "activity" && (
            <motion.div
              key="activity"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="grid grid-cols-2 gap-6"
            >
              <ActivityFeed maxItems={20} />
              
              <div className="space-y-6">
                <GlassPanel className="p-6">
                  <h3 className="text-white font-semibold mb-4">Activity Feed Features</h3>
                  <ul className="space-y-3 text-sm text-white/70">
                    <li className="flex items-start gap-3">
                      <span className="text-cyan-400 text-lg">⚡</span>
                      <div>
                        <strong className="text-white">Real-time Updates</strong>
                        <p className="text-white/50">New events appear automatically every 5 seconds</p>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="text-purple-400 text-lg">🔍</span>
                      <div>
                        <strong className="text-white">Filter by Type</strong>
                        <p className="text-white/50">Filter by All, Sessions, Rewards, or Errors</p>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="text-green-400 text-lg">⏸️</span>
                      <div>
                        <strong className="text-white">Pause/Resume</strong>
                        <p className="text-white/50">Pause the feed to examine events</p>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="text-yellow-400 text-lg">🎨</span>
                      <div>
                        <strong className="text-white">Event Types</strong>
                        <p className="text-white/50">Session, Bandwidth, Rewards, Status, Errors</p>
                      </div>
                    </li>
                  </ul>
                </GlassPanel>

                <GlassPanel className="p-6">
                  <h3 className="text-white font-semibold mb-4">Event Icons</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5">
                      <span className="text-xl">🔌</span>
                      <span className="text-white/80 text-sm">Session Start/End</span>
                    </div>
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5">
                      <span className="text-xl">📊</span>
                      <span className="text-white/80 text-sm">Bandwidth</span>
                    </div>
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5">
                      <span className="text-xl">💰</span>
                      <span className="text-white/80 text-sm">Rewards</span>
                    </div>
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5">
                      <span className="text-xl">⚠️</span>
                      <span className="text-white/80 text-sm">Errors</span>
                    </div>
                  </div>
                </GlassPanel>
              </div>
            </motion.div>
          )}

          {activeDemo === "compare" && (
            <motion.div
              key="compare"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              {/* Node Selection */}
              <GlassPanel className="p-4">
                <h3 className="text-white font-semibold mb-4">Select Nodes to Compare</h3>
                <div className="flex gap-3">
                  {mockNodesForComparison.map((node) => (
                    <button
                      key={node.id}
                      onClick={() => toggleNode(node.id)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                        selectedNodes.includes(node.id)
                          ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                          : "bg-white/5 text-white/40 hover:text-white hover:bg-white/10"
                      }`}
                    >
                      {selectedNodes.includes(node.id) && "✓ "}
                      {node.name}
                    </button>
                  ))}
                </div>
              </GlassPanel>

              {/* Comparison Panel */}
              {comparisonNodes.length > 0 ? (
                <NodeComparison
                  nodes={comparisonNodes}
                  onRemoveNode={(id) => toggleNode(id)}
                  onClearAll={() => setSelectedNodes([])}
                />
              ) : (
                <GlassPanel className="p-8 text-center text-white/40">
                  <p>Select at least one node to compare</p>
                </GlassPanel>
              )}

              {/* Feature List */}
              <div className="grid grid-cols-3 gap-6">
                <GlassPanel className="p-6">
                  <h3 className="text-cyan-400 font-semibold mb-3">Radar Chart</h3>
                  <ul className="text-white/70 text-sm space-y-2">
                    <li>• 6 metrics comparison</li>
                    <li>• Normalized values (0-100)</li>
                    <li>• Color-coded nodes</li>
                    <li>• Interactive legend</li>
                  </ul>
                </GlassPanel>

                <GlassPanel className="p-6">
                  <h3 className="text-purple-400 font-semibold mb-3">Bar View</h3>
                  <ul className="text-white/70 text-sm space-y-2">
                    <li>• Side-by-side comparison</li>
                    <li>• Progress bars</li>
                    <li>• Value labels</li>
                    <li>• Easy scanning</li>
                  </ul>
                </GlassPanel>

                <GlassPanel className="p-6">
                  <h3 className="text-green-400 font-semibold mb-3">Summary Stats</h3>
                  <ul className="text-white/70 text-sm space-y-2">
                    <li>• Best uptime</li>
                    <li>• Lowest latency</li>
                    <li>• Highest rewards</li>
                    <li>• Quick insights</li>
                  </ul>
                </GlassPanel>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default function PanelDemo() {
  return (
    <ThemeProvider defaultTheme="dark">
      <DemoContent />
    </ThemeProvider>
  );
}

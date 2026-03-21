"use client";

/**
 * Node Comparison Panel
 * Compare metrics between multiple nodes
 */

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GlassPanel } from "../components/GlassPanel";
import { 
  RadarChart, 
  PolarGrid, 
  PolarAngleAxis, 
  PolarRadiusAxis, 
  Radar, 
  ResponsiveContainer,
  Legend,
  Tooltip
} from "recharts";

interface NodeMetrics {
  id: string;
  name: string;
  uptime: number;
  latency: number;
  bandwidth: number;
  cpu: number;
  memory: number;
  rewards: number;
}

interface NodeComparisonProps {
  nodes: NodeMetrics[];
  onRemoveNode?: (id: string) => void;
  onClearAll?: () => void;
  className?: string;
}

// Radar chart data transformer
const transformForRadar = (nodes: NodeMetrics[]) => {
  const metrics = ["uptime", "latency", "bandwidth", "cpu", "memory", "rewards"];
  const metricLabels: Record<string, string> = {
    uptime: "Uptime",
    latency: "Latency",
    bandwidth: "Bandwidth",
    cpu: "CPU",
    memory: "Memory",
    rewards: "Rewards",
  };
  
  return metrics.map((metric) => ({
    metric: metricLabels[metric],
    ...nodes.reduce((acc, node) => ({
      ...acc,
      [node.name]: normalizeValue(metric, node[metric as keyof NodeMetrics] as number),
    }), {}),
  }));
};

// Normalize values to 0-100 scale for radar chart
const normalizeValue = (metric: string, value: number): number => {
  switch (metric) {
    case "uptime":
      return value; // Already 0-100
    case "latency":
      return Math.max(0, 100 - value); // Invert: lower is better
    case "bandwidth":
      return Math.min(100, value / 10); // Scale: assume max 1000 Mbps
    case "cpu":
      return 100 - value; // Invert: lower usage is better
    case "memory":
      return 100 - value; // Invert: lower usage is better
    case "rewards":
      return Math.min(100, value * 10); // Scale
    default:
      return value;
  }
};

// Color palette for nodes
const nodeColors = ["#00F5FF", "#B24DFF", "#39FF14", "#FF2D9E", "#FFD700"];

// Metric Bar Component
function MetricBar({ 
  label, 
  nodes, 
  metric, 
  unit = "",
  max = 100
}: { 
  label: string; 
  nodes: NodeMetrics[]; 
  metric: keyof NodeMetrics; 
  unit?: string;
  max?: number;
}) {
  return (
    <div className="mb-4">
      <div className="flex justify-between text-sm mb-2">
        <span className="text-white/60">{label}</span>
      </div>
      <div className="space-y-2">
        {nodes.map((node, index) => {
          const value = node[metric] as number;
          const percentage = Math.min((value / max) * 100, 100);
          
          return (
            <div key={node.id} className="flex items-center gap-3">
              <div 
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: nodeColors[index % nodeColors.length] }}
              />
              <span className="text-white/80 text-sm w-20 truncate">{node.name}</span>
              <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ backgroundColor: nodeColors[index % nodeColors.length] }}
                  initial={{ width: 0 }}
                  animate={{ width: `${percentage}%` }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                />
              </div>
              <span className="text-white/60 text-sm w-16 text-right">
                {value.toFixed(1)}{unit}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function NodeComparison({ 
  nodes, 
  onRemoveNode, 
  onClearAll,
  className = "" 
}: NodeComparisonProps) {
  const [viewMode, setViewMode] = useState<"radar" | "bars">("radar");
  
  if (nodes.length === 0) return null;
  
  const radarData = transformForRadar(nodes);
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className={className}
    >
      <GlassPanel intensity="heavy" className="overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-white/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">📊</span>
              <h3 className="text-white font-semibold">Node Comparison</h3>
              <span className="px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400 text-xs">
                {nodes.length} nodes
              </span>
            </div>
            <div className="flex items-center gap-2">
              {/* View Toggle */}
              <div className="flex bg-white/5 rounded-lg p-0.5">
                <button
                  onClick={() => setViewMode("radar")}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                    viewMode === "radar"
                      ? "bg-cyan-500/20 text-cyan-400"
                      : "text-white/40 hover:text-white"
                  }`}
                >
                  Radar
                </button>
                <button
                  onClick={() => setViewMode("bars")}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                    viewMode === "bars"
                      ? "bg-cyan-500/20 text-cyan-400"
                      : "text-white/40 hover:text-white"
                  }`}
                >
                  Bars
                </button>
              </div>
              
              {onClearAll && (
                <button
                  onClick={onClearAll}
                  className="p-2 hover:bg-red-500/20 hover:text-red-400 rounded-lg transition-colors text-white/40"
                  title="Clear all"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>
          
          {/* Node Legend */}
          <div className="flex flex-wrap gap-3 mt-3">
            {nodes.map((node, index) => (
              <div 
                key={node.id}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 group"
              >
                <div 
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: nodeColors[index % nodeColors.length] }}
                />
                <span className="text-white/80 text-sm">{node.name}</span>
                {onRemoveNode && (
                  <button
                    onClick={() => onRemoveNode(node.id)}
                    className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-red-400 transition-all"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
        
        {/* Content */}
        <div className="p-4">
          <AnimatePresence mode="wait">
            {viewMode === "radar" ? (
              <motion.div
                key="radar"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="h-64"
              >
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                  <RadarChart cx="50%" cy="50%" outerRadius="80%" data={radarData}>
                    <PolarGrid stroke="rgba(255,255,255,0.1)" />
                    <PolarAngleAxis 
                      dataKey="metric" 
                      tick={{ fill: "rgba(255,255,255,0.6)", fontSize: 11 }}
                    />
                    <PolarRadiusAxis 
                      angle={90} 
                      domain={[0, 100]} 
                      tick={false}
                      axisLine={false}
                    />
                    {nodes.map((node, index) => (
                      <Radar
                        key={node.id}
                        name={node.name}
                        dataKey={node.name}
                        stroke={nodeColors[index % nodeColors.length]}
                        fill={nodeColors[index % nodeColors.length]}
                        fillOpacity={0.2}
                        strokeWidth={2}
                      />
                    ))}
                    <Legend 
                      wrapperStyle={{ paddingTop: "20px" }}
                      formatter={(value) => <span style={{ color: "rgba(255,255,255,0.8)" }}>{value}</span>}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "rgba(10,10,15,0.95)",
                        border: "1px solid rgba(0,245,255,0.3)",
                        borderRadius: "8px",
                        color: "#fff",
                      }}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </motion.div>
            ) : (
              <motion.div
                key="bars"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4 max-h-64 overflow-y-auto"
              >
                <MetricBar 
                  label="Uptime" 
                  nodes={nodes} 
                  metric="uptime" 
                  unit="%"
                  max={100}
                />
                <MetricBar 
                  label="Latency" 
                  nodes={nodes} 
                  metric="latency" 
                  unit="ms"
                  max={200}
                />
                <MetricBar 
                  label="Bandwidth" 
                  nodes={nodes} 
                  metric="bandwidth" 
                  unit="Mbps"
                  max={1000}
                />
                <MetricBar 
                  label="CPU Usage" 
                  nodes={nodes} 
                  metric="cpu" 
                  unit="%"
                  max={100}
                />
                <MetricBar 
                  label="Memory Usage" 
                  nodes={nodes} 
                  metric="memory" 
                  unit="%"
                  max={100}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        
        {/* Summary Stats */}
        <div className="px-4 py-3 border-t border-white/10 bg-white/5">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-white/40 text-xs mb-1">Best Uptime</div>
              <div className="text-green-400 font-semibold">
                {Math.max(...nodes.map(n => n.uptime)).toFixed(1)}%
              </div>
            </div>
            <div>
              <div className="text-white/40 text-xs mb-1">Lowest Latency</div>
              <div className="text-cyan-400 font-semibold">
                {Math.min(...nodes.map(n => n.latency)).toFixed(0)}ms
              </div>
            </div>
            <div>
              <div className="text-white/40 text-xs mb-1">Highest Rewards</div>
              <div className="text-purple-400 font-semibold">
                {Math.max(...nodes.map(n => n.rewards)).toFixed(2)} PRXY
              </div>
            </div>
          </div>
        </div>
      </GlassPanel>
    </motion.div>
  );
}

export default NodeComparison;

"use client";

/**
 * Enhanced Node Details Panel
 * Comprehensive node information with charts and metrics
 */

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GlassPanel } from "../components/GlassPanel";
import { useMapTheme } from "../styles";
import { 
  LineChart, 
  Line, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as RechartsTooltip, 
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell
} from "recharts";

interface NodeDetails {
  node_id: string;
  city?: string;
  country: string;
  region: string;
  is_active: boolean;
  is_validator: boolean;
  uptime_percent: number;
  active_sessions: number;
  latency_ms: number;
  bandwidth_mbps: number;
  cpu_percent: number;
  memory_percent: number;
  disk_usage_gb: number;
  total_bandwidth_tb: number;
  rewards_24h: number;
  rewards_total: number;
  first_seen: string;
  last_seen: string;
  version: string;
}

interface NodeDetailsPanelProps {
  node: NodeDetails | null;
  onClose: () => void;
  historicalData?: BandwidthData[];
  latencyData?: LatencyData[];
}

interface BandwidthData {
  timestamp: string;
  upload: number;
  download: number;
}

interface LatencyData {
  timestamp: string;
  latency: number;
}

// Mock historical data generator
const generateMockData = (hours: number = 24): { bandwidth: BandwidthData[]; latency: LatencyData[] } => {
  const bandwidth: BandwidthData[] = [];
  const latency: LatencyData[] = [];
  
  for (let i = 0; i < hours; i++) {
    const time = new Date();
    time.setHours(time.getHours() - (hours - i));
    const timeStr = time.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
    
    bandwidth.push({
      timestamp: timeStr,
      upload: Math.round(50 + Math.random() * 100),
      download: Math.round(100 + Math.random() * 200),
    });
    
    latency.push({
      timestamp: timeStr,
      latency: Math.round(20 + Math.random() * 80),
    });
  }
  
  return { bandwidth, latency };
};

// Metric Card Component
function MetricCard({ 
  label, 
  value, 
  unit = "", 
  trend, 
  trendValue,
  icon,
  color = "cyan"
}: { 
  label: string; 
  value: number | string; 
  unit?: string;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  icon?: string;
  color?: "cyan" | "purple" | "green" | "yellow" | "red";
}) {
  const colors = {
    cyan: "from-cyan-500/20 to-cyan-500/5 border-cyan-500/30",
    purple: "from-purple-500/20 to-purple-500/5 border-purple-500/30",
    green: "from-green-500/20 to-green-500/5 border-green-500/30",
    yellow: "from-yellow-500/20 to-yellow-500/5 border-yellow-500/30",
    red: "from-red-500/20 to-red-500/5 border-red-500/30",
  };

  return (
    <div className={`p-4 rounded-lg bg-gradient-to-br ${colors[color]} border`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-white/60 text-xs uppercase tracking-wider">{label}</span>
        {icon && <span className="text-lg">{icon}</span>}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold text-white">{value}</span>
        {unit && <span className="text-white/40 text-sm">{unit}</span>}
      </div>
      {trend && (
        <div className={`flex items-center gap-1 mt-2 text-xs ${
          trend === "up" ? "text-green-400" : trend === "down" ? "text-red-400" : "text-white/40"
        }`}>
          <span>{trend === "up" ? "↑" : trend === "down" ? "↓" : "→"}</span>
          <span>{trendValue}</span>
        </div>
      )}
    </div>
  );
}

// Progress Bar Component
function ProgressBar({ 
  value, 
  label, 
  color = "cyan",
  max = 100
}: { 
  value: number; 
  label: string; 
  color?: string;
  max?: number;
}) {
  const percentage = Math.min((value / max) * 100, 100);
  
  return (
    <div className="mb-4">
      <div className="flex justify-between text-sm mb-1">
        <span className="text-white/60">{label}</span>
        <span className="text-white font-medium">{value.toFixed(1)}%</span>
      </div>
      <div className="h-2 bg-white/10 rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}

// Tab Button Component
function TabButton({ 
  active, 
  onClick, 
  label, 
  icon 
}: { 
  active: boolean; 
  onClick: () => void; 
  label: string; 
  icon: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
        active 
          ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30" 
          : "text-white/60 hover:text-white hover:bg-white/5"
      }`}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

// Status Badge Component
function StatusBadge({ isActive, isValidator }: { isActive: boolean; isValidator: boolean }) {
  if (isValidator) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-500/20 border border-purple-500/30 text-purple-400 text-xs font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
        ★ Validator
      </span>
    );
  }
  
  if (isActive) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-500/20 border border-green-500/30 text-green-400 text-xs font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
        ● Online
      </span>
    );
  }
  
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-medium">
      <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
      ○ Offline
    </span>
  );
}

export function NodeDetailsPanel({ 
  node, 
  onClose,
  historicalData,
  latencyData
}: NodeDetailsPanelProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "performance" | "rewards">("overview");
  const [isMounted, setIsMounted] = useState(false);
  const [data, setData] = useState<{ bandwidth: BandwidthData[]; latency: LatencyData[] }>({
    bandwidth: [],
    latency: [],
  });
  
  const { themeConfig } = useMapTheme();

  useEffect(() => {
    setIsMounted(true);
  }, []);
  
  useEffect(() => {
    if (node) {
      const mockData = generateMockData(24);
      setData({
        bandwidth: historicalData || mockData.bandwidth,
        latency: latencyData || mockData.latency,
      });
    }
  }, [node, historicalData, latencyData]);
  
  if (!node) return null;

  return (
    <motion.div
      initial={{ x: 400, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 400, opacity: 0 }}
      transition={{ type: "spring", damping: 25 }}
      className="absolute right-4 top-24 z-40 w-[420px] max-h-[calc(100vh-120px)] overflow-y-auto"
    >
      <GlassPanel intensity="heavy" className="p-0 overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-white/10">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h2 className="text-xl font-bold text-white mb-1">
                {node.city || "Unknown Location"}
              </h2>
              <p className="text-white/40 text-sm">
                {node.country} • {node.region}
              </p>
            </div>
            <button 
              onClick={onClose}
              className="text-white/40 hover:text-white transition-colors p-1"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          <div className="flex items-center gap-3">
            <StatusBadge isActive={node.is_active} isValidator={node.is_validator} />
            <span className="text-white/30 text-xs">ID: {node.node_id.slice(0, 8)}...</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="px-6 py-4 border-b border-white/10">
          <div className="flex gap-2">
            <TabButton 
              active={activeTab === "overview"} 
              onClick={() => setActiveTab("overview")}
              label="Overview"
              icon="📊"
            />
            <TabButton 
              active={activeTab === "performance"} 
              onClick={() => setActiveTab("performance")}
              label="Performance"
              icon="⚡"
            />
            <TabButton 
              active={activeTab === "rewards"} 
              onClick={() => setActiveTab("rewards")}
              label="Rewards"
              icon="💰"
            />
          </div>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          <AnimatePresence mode="wait">
            {activeTab === "overview" && (
              <motion.div
                key="overview"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                {/* Quick Stats Grid */}
                <div className="grid grid-cols-2 gap-3">
                  <MetricCard 
                    label="Uptime" 
                    value={(node.uptime_percent || 0).toFixed(1)} 
                    unit="%"
                    trend="up"
                    trendValue="+0.5%"
                    icon="⏱️"
                    color="green"
                  />
                  <MetricCard 
                    label="Sessions" 
                    value={node.active_sessions || 0}
                    trend="up"
                    trendValue="+3"
                    icon="👥"
                    color="cyan"
                  />
                  <MetricCard 
                    label="Latency" 
                    value={node.latency_ms || 0}
                    unit="ms"
                    trend="down"
                    trendValue="-5ms"
                    icon="📡"
                    color="yellow"
                  />
                  <MetricCard 
                    label="Bandwidth" 
                    value={node.bandwidth_mbps || 0}
                    unit="Mbps"
                    trend="up"
                    trendValue="+12%"
                    icon="🌐"
                    color="purple"
                  />
                </div>

                {/* Resource Usage */}
                <div className="bg-white/5 rounded-lg p-4">
                  <h3 className="text-white/80 text-sm font-medium mb-4">Resource Usage</h3>
                  <ProgressBar 
                    value={node.cpu_percent || 0} 
                    label="CPU" 
                    color={(node.cpu_percent || 0) > 80 ? "#FF4444" : "#00F5FF"}
                  />
                  <ProgressBar 
                    value={node.memory_percent || 0} 
                    label="Memory" 
                    color={(node.memory_percent || 0) > 80 ? "#FF4444" : "#B24DFF"}
                  />
                  <ProgressBar 
                    value={((node.disk_usage_gb || 0) / 100) * 100} 
                    label="Disk" 
                    color="#39FF14"
                    max={100}
                  />
                </div>

                {/* Version Info */}
                <div className="flex justify-between text-sm">
                  <span className="text-white/40">Version</span>
                  <span className="text-white/80 font-mono">{node.version || 'unknown'}</span>
                </div>
              </motion.div>
            )}

            {activeTab === "performance" && (
              <motion.div
                key="performance"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                {/* Bandwidth Chart */}
                <div>
                  <h3 className="text-white/80 text-sm font-medium mb-3">Bandwidth (24h)</h3>
                  <div className="h-48 bg-white/5 rounded-lg p-3">
                    {isMounted && data.bandwidth.length > 0 && (
                      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                        <AreaChart data={data.bandwidth}>
                          <defs>
                            <linearGradient id="uploadGradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#00F5FF" stopOpacity={0.3}/>
                              <stop offset="95%" stopColor="#00F5FF" stopOpacity={0}/>
                            </linearGradient>
                            <linearGradient id="downloadGradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#B24DFF" stopOpacity={0.3}/>
                              <stop offset="95%" stopColor="#B24DFF" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                          <XAxis 
                            dataKey="timestamp" 
                            stroke="rgba(255,255,255,0.3)"
                            tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10 }}
                            tickMargin={8}
                          />
                          <YAxis 
                            stroke="rgba(255,255,255,0.3)"
                            tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10 }}
                          />
                          <RechartsTooltip 
                            contentStyle={{ 
                              backgroundColor: "rgba(10,10,15,0.95)",
                              border: "1px solid rgba(0,245,255,0.3)",
                              borderRadius: "8px",
                              color: "#fff"
                            }}
                          />
                          <Area 
                            type="monotone" 
                            dataKey="upload" 
                            stroke="#00F5FF" 
                            fillOpacity={1} 
                            fill="url(#uploadGradient)" 
                            strokeWidth={2}
                          />
                          <Area 
                            type="monotone" 
                            dataKey="download" 
                            stroke="#B24DFF" 
                            fillOpacity={1} 
                            fill="url(#downloadGradient)" 
                            strokeWidth={2}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>

                {/* Latency Chart */}
                <div>
                  <h3 className="text-white/80 text-sm font-medium mb-3">Latency (24h)</h3>
                  <div className="h-40 bg-white/5 rounded-lg p-3">
                    {isMounted && data.latency.length > 0 && (
                      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                        <LineChart data={data.latency}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                          <XAxis 
                            dataKey="timestamp" 
                            stroke="rgba(255,255,255,0.3)"
                            tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10 }}
                          />
                          <YAxis 
                            stroke="rgba(255,255,255,0.3)"
                            tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10 }}
                          />
                          <RechartsTooltip 
                            contentStyle={{ 
                              backgroundColor: "rgba(10,10,15,0.95)",
                              border: "1px solid rgba(255,45,158,0.3)",
                              borderRadius: "8px",
                              color: "#fff"
                            }}
                          />
                          <Line 
                            type="monotone" 
                            dataKey="latency" 
                            stroke="#FF2D9E" 
                            strokeWidth={2}
                            dot={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === "rewards" && (
              <motion.div
                key="rewards"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                {/* Reward Stats */}
                <div className="grid grid-cols-2 gap-3">
                  <MetricCard 
                    label="24h Rewards" 
                    value={(node.rewards_24h || 0).toFixed(2)} 
                    unit="PRXY"
                    trend="up"
                    trendValue="+5.2%"
                    icon="⏰"
                    color="green"
                  />
                  <MetricCard 
                    label="Total Rewards" 
                    value={(node.rewards_total || 0).toFixed(2)} 
                    unit="PRXY"
                    icon="💎"
                    color="purple"
                  />
                </div>

                {/* Total Bandwidth Contribution */}
                <div className="bg-gradient-to-br from-purple-500/10 to-cyan-500/10 rounded-lg p-4 border border-white/10">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-white/60 text-sm">Total Data Served</span>
                    <span className="text-2xl">📦</span>
                  </div>
                  <div className="text-3xl font-bold text-white mb-1">
                    {(node.total_bandwidth_tb || 0).toFixed(2)}
                    <span className="text-lg text-white/60 ml-1">TB</span>
                  </div>
                  <div className="text-xs text-white/40">
                    Since {node.first_seen ? new Date(node.first_seen).toLocaleDateString() : '—'}
                  </div>
                </div>

                {/* Activity Timeline */}
                <div>
                  <h3 className="text-white/80 text-sm font-medium mb-3">Activity</h3>
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 text-sm">
                      <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center text-green-400">
                        ✓
                      </div>
                      <div className="flex-1">
                        <div className="text-white">Node online</div>
                        <div className="text-white/40 text-xs">{new Date(node.last_seen).toLocaleString()}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <div className="w-8 h-8 rounded-full bg-cyan-500/20 flex items-center justify-center text-cyan-400">
                        ↑
                      </div>
                      <div className="flex-1">
                        <div className="text-white">Bandwidth milestone: 10TB</div>
                        <div className="text-white/40 text-xs">2 days ago</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400">
                        ★
                      </div>
                      <div className="flex-1">
                        <div className="text-white">Validator status granted</div>
                        <div className="text-white/40 text-xs">1 week ago</div>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10 bg-white/5">
          <div className="flex justify-between text-xs text-white/40">
            <span>First seen: {new Date(node.first_seen).toLocaleDateString()}</span>
            <span>Last seen: {new Date(node.last_seen).toLocaleDateString()}</span>
          </div>
        </div>
      </GlassPanel>
    </motion.div>
  );
}

export default NodeDetailsPanel;

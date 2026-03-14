"use client";

import { useState, useEffect } from "react";
import { Server, RefreshCw, Wifi, WifiOff, Clock } from "lucide-react";
import { listNodes, getNodeStats, type ProxyNode, type NodeStats } from "@/lib/api";

function NodeCard({ node }: { node: ProxyNode }) {
  const healthy = node.is_healthy;
  return (
    <div className={`admin-card space-y-3 border ${healthy ? "border-emerald-500/20" : "border-red-500/20"}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          {healthy
            ? <Wifi className="w-4 h-4 text-emerald-400" />
            : <WifiOff className="w-4 h-4 text-red-400" />
          }
          <div>
            <p className="text-sm font-medium text-white font-mono">{node.ip_address}</p>
            <p className="text-xs text-[#4a4a6a]">{node.country_code} · {node.region}</p>
          </div>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded border ${
          healthy
            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
            : "bg-red-500/10 border-red-500/20 text-red-400"
        }`}>
          {healthy ? "Online" : "Offline"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        {[
          ["Connections", `${node.active_connections} / ${node.max_connections}`],
          ["Latency", `${node.latency_ms} ms`],
          ["Uptime", `${node.uptime_percent?.toFixed(1) ?? "—"}%`],
          ["Last Seen", node.last_seen ? new Date(node.last_seen).toLocaleTimeString() : "—"],
        ].map(([k, v]) => (
          <div key={k} className="bg-[#0a0a0f] rounded-lg p-2 border border-[#1e1e2e]">
            <p className="text-[#4a4a6a]">{k}</p>
            <p className="text-white font-mono mt-0.5">{v}</p>
          </div>
        ))}
      </div>

      {/* Connection bar */}
      <div>
        <div className="flex justify-between text-[10px] text-[#4a4a6a] mb-1">
          <span>Load</span>
          <span>{node.max_connections ? Math.round((node.active_connections / node.max_connections) * 100) : 0}%</span>
        </div>
        <div className="h-1.5 bg-[#1e1e2e] rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              node.max_connections && node.active_connections / node.max_connections > 0.8
                ? "bg-red-400"
                : "bg-emerald-400"
            }`}
            style={{ width: `${node.max_connections ? Math.min(100, (node.active_connections / node.max_connections) * 100) : 0}%` }}
          />
        </div>
      </div>
    </div>
  );
}

export default function NodesPage() {
  const [nodes, setNodes] = useState<ProxyNode[]>([]);
  const [stats, setStats] = useState<NodeStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [n, s] = await Promise.all([listNodes(), getNodeStats()]);
      setNodes(n.nodes);
      setStats(s);
    } catch { /* handled */ }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-5">
      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Nodes", value: stats?.total_nodes ?? "—", icon: <Server className="w-4 h-4" />, color: "text-indigo-400 bg-indigo-500/10 border-indigo-500/20" },
          { label: "Online", value: stats?.online_nodes ?? "—", icon: <Wifi className="w-4 h-4" />, color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
          { label: "Offline", value: stats?.offline_nodes ?? "—", icon: <WifiOff className="w-4 h-4" />, color: "text-red-400 bg-red-500/10 border-red-500/20" },
          { label: "Avg Latency", value: `${stats?.avg_latency_ms ?? "—"} ms`, icon: <Clock className="w-4 h-4" />, color: "text-sky-400 bg-sky-500/10 border-sky-500/20" },
        ].map((s) => (
          <div key={s.label} className="admin-card flex items-center gap-3">
            <div className={`p-2 rounded-lg border ${s.color}`}>{s.icon}</div>
            <div>
              <p className="text-xs text-[#94a3b8]">{s.label}</p>
              <p className="text-xl font-bold text-white">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Node Grid</h2>
        <button
          onClick={load}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-[#111118] border border-[#1e1e2e] text-[#94a3b8] hover:text-white transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : nodes.length === 0 ? (
        <div className="admin-card text-center py-16 text-[#4a4a6a]">No nodes registered</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {nodes.map((n) => <NodeCard key={n.id} node={n} />)}
        </div>
      )}
    </div>
  );
}

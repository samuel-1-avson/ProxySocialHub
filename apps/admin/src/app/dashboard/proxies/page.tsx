"use client";

import { useState, useEffect } from "react";
import { Globe, Power, PowerOff } from "lucide-react";
import { listProxyPools, disablePool, type ProxyPool } from "@/lib/api";

export default function ProxiesPage() {
  const [pools, setPools] = useState<ProxyPool[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await listProxyPools();
      setPools(res.pools);
    } catch { /* handled */ }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleDisable = async (id: string) => {
    if (!confirm("Disable this proxy pool?")) return;
    setActing(id);
    try { await disablePool(id); await load(); }
    catch (e) { alert(String(e)); }
    finally { setActing(null); }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Globe className="w-4 h-4 text-indigo-400" />
        <h2 className="text-sm font-semibold text-white">Proxy Pool Management</h2>
      </div>

      <div className="admin-card !p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full admin-table text-sm">
            <thead>
              <tr className="border-b border-[#1e1e2e]">
                {["Pool Name", "ID", "Max Sessions", "Status", "Created", "Action"].map((h) => (
                  <th key={h} className="text-left text-[10px] font-semibold text-[#4a4a6a] uppercase tracking-wider px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e1e2e]">
              {loading && (
                <tr><td colSpan={6} className="text-center py-12 text-[#4a4a6a]">Loading…</td></tr>
              )}
              {!loading && pools.length === 0 && (
                <tr><td colSpan={6} className="text-center py-12 text-[#4a4a6a]">No proxy pools found</td></tr>
              )}
              {pools.map((pool) => (
                <tr key={pool.id} className="transition-colors">
                  <td className="px-4 py-3 text-white font-medium">{pool.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-[#94a3b8]">{pool.id.slice(0, 8)}…</td>
                  <td className="px-4 py-3 text-[#94a3b8]">{pool.max_sessions}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded border ${
                      pool.is_active
                        ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                        : "bg-red-500/10 border-red-500/20 text-red-400"
                    }`}>
                      {pool.is_active ? "Active" : "Disabled"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-[#94a3b8]">
                    {new Date(pool.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    {pool.is_active ? (
                      <button
                        onClick={() => handleDisable(pool.id)}
                        disabled={acting === pool.id}
                        className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 disabled:opacity-40 transition-colors"
                      >
                        <PowerOff className="w-3.5 h-3.5" />
                        {acting === pool.id ? "…" : "Disable"}
                      </button>
                    ) : (
                      <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 text-[#4a4a6a]">
                        <Power className="w-3.5 h-3.5" />
                        Disabled
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import {
  Users, Activity, Server, DollarSign, AlertTriangle,
  TrendingUp, CheckCircle, XCircle, Clock, Scale,
} from "lucide-react";
import {
  getDashboardStats, getSystemHealth, getSystemAlerts,
  type DashboardStats, type SystemHealth, type SystemAlerts,
} from "@/lib/api";

function StatCard({
  label, value, sub, icon, color = "indigo",
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  color?: "indigo" | "emerald" | "amber" | "red" | "sky";
}) {
  const colors = {
    indigo: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
    emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    amber:   "bg-amber-500/10 text-amber-400 border-amber-500/20",
    red:     "bg-red-500/10 text-red-400 border-red-500/20",
    sky:     "bg-sky-500/10 text-sky-400 border-sky-500/20",
  };
  return (
    <div className="admin-card flex items-start gap-4">
      <div className={`p-2.5 rounded-lg border ${colors[color]}`}>{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-[#94a3b8] mb-0.5">{label}</p>
        <p className="text-2xl font-bold text-white">{value}</p>
        {sub && <p className="text-xs text-[#4a4a6a] mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function ServiceBadge({ name, status }: { name: string; status: string }) {
  const dot = status === "ok" ? "ok" : status === "degraded" ? "warn" : "down";
  const label = status === "ok" ? "Online" : status === "degraded" ? "Degraded" : "Offline";
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e]">
      <span className="text-sm text-[#94a3b8] capitalize">{name}</span>
      <div className="flex items-center gap-2">
        <span className={`status-dot ${dot}`} />
        <span className={`text-xs ${status === "ok" ? "text-emerald-400" : status === "degraded" ? "text-amber-400" : "text-red-400"}`}>{label}</span>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [alerts, setAlerts] = useState<SystemAlerts | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const [s, h, a] = await Promise.all([
        getDashboardStats(),
        getSystemHealth(),
        getSystemAlerts(),
      ]);
      setStats(s);
      setHealth(h);
      setAlerts(a);
    } catch (e) {
      console.error("Dashboard load error:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 15_000); // refresh every 15s
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* System health banner */}
      {health && health.overall !== "ok" && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <p className="text-sm font-medium">
            System health is <strong>{health.overall}</strong>. Check the services panel below.
          </p>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="Total Users"
          value={stats?.total_users ?? "—"}
          sub={`+${stats?.new_users_today ?? 0} today · +${stats?.new_users_week ?? 0} this week`}
          icon={<Users className="w-5 h-5" />}
          color="indigo"
        />
        <StatCard
          label="Active Sessions"
          value={stats?.active_sessions ?? "—"}
          sub={`${stats?.sessions_today ?? 0} started today`}
          icon={<Activity className="w-5 h-5" />}
          color="emerald"
        />
        <StatCard
          label="Online Nodes"
          value={`${stats?.online_nodes ?? 0} / ${stats?.total_nodes ?? 0}`}
          sub={`${stats?.healthy_percent?.toFixed(1) ?? 0}% healthy`}
          icon={<Server className="w-5 h-5" />}
          color="sky"
        />
        <StatCard
          label="Revenue (Month)"
          value={`${(stats?.month_revenue_ghs ?? 0).toFixed(2)} SOL`}
          sub={`Today: ${(stats?.today_revenue_ghs ?? 0).toFixed(2)} · Week: ${(stats?.week_revenue_ghs ?? 0).toFixed(2)}`}
          icon={<DollarSign className="w-5 h-5" />}
          color="amber"
        />
      </div>

      {/* Second row */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="Suspended / Banned"
          value={stats?.suspended_users ?? "—"}
          icon={<XCircle className="w-5 h-5" />}
          color="red"
        />
        <StatCard
          label="Active Anomalies"
          value={alerts?.count.anomalies ?? "—"}
          icon={<AlertTriangle className="w-5 h-5" />}
          color="amber"
        />
        <StatCard
          label="Account Lockouts"
          value={alerts?.count.lockouts ?? "—"}
          icon={<Clock className="w-5 h-5" />}
          color="red"
        />
        <StatCard
          label="Open Disputes"
          value="—"
          icon={<Scale className="w-5 h-5" />}
          color="indigo"
        />
      </div>

      {/* Bottom grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Service Health */}
        <div className="admin-card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">Service Health</h2>
            <div className="flex items-center gap-1.5">
              <span className={`status-dot ${health?.overall === "ok" ? "ok" : "warn"}`} />
              <span className="text-xs text-[#94a3b8] capitalize">{health?.overall ?? "unknown"}</span>
            </div>
          </div>
          <div className="space-y-2">
            {(health?.services ?? []).map((s) => (
              <ServiceBadge key={s.name} name={s.name} status={s.status} />
            ))}
            {!health?.services?.length && (
              <p className="text-sm text-[#4a4a6a] text-center py-4">No health data available</p>
            )}
          </div>
        </div>

        {/* Recent Anomalies */}
        <div className="admin-card">
          <h2 className="text-sm font-semibold text-white mb-4">Recent Security Events</h2>
          <div className="space-y-2">
            {(alerts?.anomalies ?? []).slice(0, 6).map((a) => (
              <div key={a.id} className="flex items-start gap-3 py-2 border-b border-[#1e1e2e] last:border-0">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-white truncate">{a.type}</p>
                  <p className="text-[10px] text-[#4a4a6a] truncate">{a.description}</p>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                  a.severity === "high" ? "bg-red-500/10 text-red-400 border-red-500/20" : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                }`}>{a.severity}</span>
              </div>
            ))}
            {!alerts?.anomalies?.length && (
              <div className="flex items-center gap-2 text-emerald-400 text-sm py-4 justify-center">
                <CheckCircle className="w-4 h-4" />
                No recent anomalies
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Revenue trend placeholder */}
      <div className="admin-card">
        <div className="flex items-center gap-2 mb-1">
          <TrendingUp className="w-4 h-4 text-indigo-400" />
          <h2 className="text-sm font-semibold text-white">Revenue Summary</h2>
        </div>
        <div className="grid grid-cols-3 gap-4 mt-4">
          {[
            { label: "Today", value: stats?.today_revenue_ghs },
            { label: "This Week", value: stats?.week_revenue_ghs },
            { label: "This Month", value: stats?.month_revenue_ghs },
          ].map((r) => (
            <div key={r.label} className="bg-[#0a0a0f] rounded-lg p-4 border border-[#1e1e2e] text-center">
              <p className="text-xs text-[#94a3b8] mb-1">{r.label}</p>
              <p className="text-xl font-bold text-white">{(r.value ?? 0).toFixed(4)}</p>
              <p className="text-[10px] text-[#4a4a6a] mt-0.5">SOL</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

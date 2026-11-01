"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DataError } from "@/components/workspace/Patterns";

import { useAuth, fetchWithAuth } from "@/lib/auth";
import {
  Loader2,
  Activity,
  Zap,
  Server,
  Globe,
  BarChart3,
  TrendingUp,
} from "lucide-react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "";

interface NetworkStatus {
  total_nodes: number;
  healthy_nodes: number;
  avg_latency: number;
  top_countries: string[];
  node_scores: Array<{
    id: string;
    country: string;
    region: string;
    score: number;
  }>;
}

interface AnalyticsOverview {
  total_requests: number;
  total_bandwidth_gb: number;
  success_rate: number;
  avg_latency_ms: number;
  active_sessions: number;
  unique_destinations: number;
  top_country: string;
  top_isp: string;
}

interface DailyUsagePoint {
  date: string;
  bytes_used: number;
  gb_used: number;
  requests: number;
  cost_sol: number;
  /** @deprecated legacy field — use cost_sol */
  cost_ghs?: number;
}

interface GeoStats {
  country_code: string;
  country_name: string;
  request_count: number;
  bytes_used: number;
  success_rate: number;
}

interface DestinationStats {
  domain: string;
  request_count: number;
  bytes_used: number;
  avg_latency_ms: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (
    parseFloat((Number(bytes || 0) / Math.pow(k, i)).toFixed(2)) +
    " " +
    sizes[i]
  );
}

function BarChart({ data, label }: { data: DailyUsagePoint[]; label: string }) {
  const safeData = Array.isArray(data) ? data : [];
  const maxValue = Math.max(...safeData.map((d) => d.gb_used), 0.01);

  return (
    <div className="space-y-4 h-full flex flex-col">
      <div className="flex justify-between text-xs font-mono font-bold text-muted-foreground normal-case">
        <span>{label}</span>
        <span>Max: {maxValue.toFixed(2)} GB</span>
      </div>
      <div className="flex items-end h-40 gap-2 flex-1">
        {safeData.map((point, index) => {
          const height = (point.gb_used / maxValue) * 100;
          return (
            <div
              key={index}
              className="flex-1 flex flex-col items-center group relative"
            >
              <div
                className="w-full bg-primary/20 border border-primary/50 group-hover:bg-primary transition-all duration-300"
                style={{ height: `${Math.max(height, 5)}%` }}
              />
              <div className="absolute bottom-full mb-2 opacity-0 group-hover:opacity-100 bg-foreground text-background text-xs font-mono p-1 rounded-sm whitespace-nowrap z-10">
                {point.date}: {(point.gb_used ?? 0).toFixed(3)} GB
              </div>
              <div className="text-xs text-muted-foreground mt-2 font-mono truncate w-full text-center">
                {point.date.slice(5)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GeoChart({ data }: { data: GeoStats[] }) {
  const safeData = Array.isArray(data) ? data : [];
  const total = safeData.reduce((sum, d) => sum + d.request_count, 0) || 1;

  return (
    <div className="space-y-4">
      {safeData.map((geo) => {
        const percent = (geo.request_count / total) * 100;
        return (
          <div key={geo.country_code} className="space-y-1">
            <div className="flex justify-between text-xs font-mono">
              <span className="font-bold">{geo.country_name}</span>
              <span className="text-muted-foreground">
                {Number(percent || 0).toFixed(1)}%
              </span>
            </div>
            <div className="h-2 bg-secondary rounded-sm overflow-hidden border border-border">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function AnalyticsPage() {
  const { isLoading, isAuthenticated } = useAuth();
  const [days, setDays] = useState(7);
  const query = useQuery({
    queryKey: ["traffic-analytics", days],
    enabled: isAuthenticated,
    retry: false,
    queryFn: async () => {
      async function read<T>(path: string): Promise<T> {
        const response = await fetchWithAuth(API_BASE_URL + path);
        if (!response.ok)
          throw new Error("Traffic analytics source is unavailable.");
        return response.json();
      }
      const [overview, daily, geo, dest, networkStatus] = await Promise.all([
        read<AnalyticsOverview>("/v1/analytics/overview"),
        read<{ data: DailyUsagePoint[] }>(
          "/v1/analytics/usage/daily?days=" + days,
        ),
        read<{ data: GeoStats[] }>("/v1/analytics/geo"),
        read<{ data: DestinationStats[] }>("/v1/analytics/top-destinations"),
        read<NetworkStatus>("/v1/network/status"),
      ]);
      return {
        overview,
        dailyUsage: daily.data ?? [],
        geoData: geo.data ?? [],
        destinations: dest.data ?? [],
        networkStatus,
      };
    },
  });
  const {
    overview,
    dailyUsage = [],
    geoData = [],
    destinations = [],
    networkStatus,
  } = query.data ?? {};
  const loading = query.isPending;
  const error = query.error?.message || "";
  if (query.isError)
    return (
      <div className="ui-page">
        <h1>Traffic analytics</h1>
        <DataError error={query.error} retry={() => void query.refetch()} />
      </div>
    );
  if (isLoading || loading) {
    return (
      <div className="flex flex-col items-center justify-center py-40 gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="font-mono text-xs normal-case tracking-normal text-muted-foreground">
          Aggregating Metrics...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 border-b border-border pb-6">
        <div>
          <h1 className="text-3xl font-bold font-mono normal-case tracking-tight mb-1">
            Traffic Analytics
          </h1>
          <p className="text-muted-foreground font-mono text-xs">
            Reported traffic performance and usage.
          </p>
        </div>
        <div className="flex gap-2">
          {[7, 14, 30].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 rounded-sm text-xs font-bold font-mono normal-case border transition-all ${
                days === d
                  ? "bg-primary text-primary-foreground border-foreground shadow-[2px_2px_0px_var(--foreground)]"
                  : "bg-background border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {d} DAYS
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 text-destructive text-xs font-mono">
          ERROR: {error}
        </div>
      )}

      {/* Overview Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: "Total Bandwidth",
            value: `${overview?.total_bandwidth_gb?.toFixed(2) || "0.00"} GB`,
            icon: Activity,
          },
          {
            label: "Success Rate",
            value:
              (overview?.total_requests ?? 0) > 0
                ? `${((overview?.success_rate || 0) * 100).toFixed(1)}%`
                : "—",
            icon: Zap,
          },
          {
            label: "Avg Latency",
            value:
              (overview?.total_requests ?? 0) > 0
                ? `${overview?.avg_latency_ms || 0} ms`
                : "—",
            icon: Server,
          },
          {
            label: "Active Sessions",
            value: overview?.active_sessions || 0,
            icon: Globe,
          },
        ].map((stat, i) => (
          <div
            key={i}
            className="card-retro p-4 bg-card group hover:border-primary transition-colors"
          >
            <div className="flex justify-between items-start mb-2">
              <stat.icon
                size={16}
                className="text-muted-foreground group-hover:text-primary transition-colors"
              />
            </div>
            <div className="text-2xl font-bold font-mono mb-1 group-hover:translate-x-1 transition-transform">
              {stat.value}
            </div>
            <div className="text-xs font-mono font-bold text-muted-foreground normal-case">
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily Usage Chart */}
        <div className="card-retro p-6 bg-card">
          <h3 className="text-sm font-bold font-mono normal-case border-b border-border pb-2 mb-4 flex gap-2 items-center">
            <BarChart3 size={16} /> Daily Throughput
          </h3>
          {dailyUsage.length > 0 ? (
            <BarChart data={dailyUsage} label="GB TRANSACTED" />
          ) : (
            <div className="h-40 flex items-center justify-center font-mono text-xs text-muted-foreground border-2 border-dashed border-border rounded-sm">
              NO USAGE DATA RECORDED
            </div>
          )}
        </div>

        {/* Geo Distribution */}
        <div className="card-retro p-6 bg-card">
          <h3 className="text-sm font-bold font-mono normal-case border-b border-border pb-2 mb-4 flex gap-2 items-center">
            <Globe size={16} /> Geo-Distribution
          </h3>
          {geoData.length > 0 ? (
            <GeoChart data={geoData} />
          ) : (
            <div className="h-40 flex items-center justify-center font-mono text-xs text-muted-foreground border-2 border-dashed border-border rounded-sm">
              NO GEO DATA RECORDED
            </div>
          )}
        </div>
      </div>
      {/* Phase 6: ML-Router Performance Map (Heatmap Table) */}
      <div className="card-retro p-6 bg-card">
        <h3 className="text-sm font-bold font-mono normal-case border-b border-border pb-2 mb-4 flex gap-2 items-center">
          <Activity size={16} /> ML-Router Performance Map (Real-Time)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {networkStatus?.node_scores.map((node) => (
            <div
              key={node.id}
              className="p-3 bg-secondary/10 border border-border rounded-sm flex justify-between items-center group hover:border-primary transition-all relative overflow-hidden"
            >
              <div className="relative z-10">
                <div className="text-xs font-mono font-bold text-muted-foreground normal-case">
                  {node.country} • {node.region}
                </div>
                <div className="text-xs font-mono font-bold truncate max-w-[120px]">
                  {node.id.split("-")[0]}...
                </div>
              </div>
              <div className="text-right relative z-10">
                <div
                  className={`text-lg font-semibold font-mono ${(node.score * 10).toFixed(0) === "10" ? "text-emerald-400" : "text-primary"}`}
                >
                  {(node.score * 100).toFixed(0)}
                </div>
                <div className="text-xs font-mono font-bold normal-case">
                  ML SCORE
                </div>
              </div>
              {/* Score Heat Indicator */}
              <div
                className="absolute bottom-0 left-0 h-1 bg-primary opacity-20 group-hover:opacity-100 transition-opacity"
                style={{ width: `${node.score * 100}%` }}
              />
            </div>
          ))}
          {!networkStatus && (
            <div className="col-span-full py-10 text-center font-mono text-xs text-muted-foreground border-2 border-dashed border-border rounded-sm">
              CONNECTING TO GATEWAY STATUS API...
            </div>
          )}
        </div>
      </div>

      {/* Top Destinations */}
      <div className="card-retro p-0 bg-card overflow-hidden">
        <div className="px-6 py-4 border-b border-border bg-secondary/10">
          <h3 className="text-sm font-bold font-mono normal-case flex gap-2 items-center">
            <TrendingUp size={16} /> Top Destinations
          </h3>
        </div>
        {destinations.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-secondary/20">
                <tr>
                  <th className="px-6 py-3 font-bold text-muted-foreground normal-case">
                    Domain
                  </th>
                  <th className="px-6 py-3 font-bold text-muted-foreground normal-case">
                    Requests
                  </th>
                  <th className="px-6 py-3 font-bold text-muted-foreground normal-case">
                    Data
                  </th>
                  <th className="px-6 py-3 font-bold text-muted-foreground normal-case">
                    Latency
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {destinations.map((dest, index) => (
                  <tr
                    key={dest.domain}
                    className="hover:bg-secondary/10 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <span className="w-5 h-5 flex items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                          #{index + 1}
                        </span>
                        <span className="font-bold">{dest.domain}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground font-bold">
                      {(dest.request_count ?? 0).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">
                      {formatBytes(Number(dest.bytes_used))}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`px-2 py-0.5 rounded-sm font-bold ${dest.avg_latency_ms < 50 ? "bg-green-500/10 text-green-500" : dest.avg_latency_ms < 100 ? "bg-yellow-500/10 text-yellow-500" : "bg-red-500/10 text-red-500"}`}
                      >
                        {dest.avg_latency_ms} ms
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-12 text-center text-muted-foreground font-mono text-xs border-2 border-dashed border-border m-4 rounded-sm">
            NO DESTINATION DATA AVAILABLE
          </div>
        )}
      </div>

      {/* Quick Insights */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card-retro p-6 bg-card">
          <h3 className="text-sm font-bold font-mono normal-case mb-4 text-muted-foreground">
            Performance Insights
          </h3>
          <ul className="space-y-3 font-mono text-xs">
            <li className="flex justify-between border-b border-dashed border-border pb-2">
              <span>Optimized Region</span>
              <span className="font-bold">
                {overview?.top_country || "N/A"}
              </span>
            </li>
            <li className="flex justify-between border-b border-dashed border-border pb-2">
              <span>Primary Carrier</span>
              <span className="font-bold">{overview?.top_isp || "N/A"}</span>
            </li>
            <li className="flex justify-between border-b border-dashed border-border pb-2">
              <span>Unique Endpoints</span>
              <span className="font-bold">
                {overview?.unique_destinations || 0}
              </span>
            </li>
          </ul>
        </div>
        <div className="card-retro p-6 bg-card">
          <h3 className="text-sm font-bold font-mono normal-case mb-4 text-muted-foreground">
            Cost Efficiency
          </h3>
          <ul className="space-y-3 font-mono text-xs">
            <li className="flex justify-between border-b border-dashed border-border pb-2">
              <span>Total Expenditure</span>
              <span className="font-bold text-primary">
                {(
                  dailyUsage?.reduce(
                    (sum, d) => sum + (d.cost_sol ?? d.cost_ghs ?? 0),
                    0,
                  ) || 0
                ).toFixed(6)}{" "}
                SOL
              </span>
            </li>
            <li className="flex justify-between border-b border-dashed border-border pb-2">
              <span>Daily Avg.</span>
              <span className="font-bold">
                {(
                  dailyUsage?.reduce((sum, d) => sum + d.gb_used, 0) /
                    (dailyUsage?.length || 1) || 0
                ).toFixed(3)}{" "}
                GB
              </span>
            </li>
            <li className="flex justify-between border-b border-dashed border-border pb-2">
              <span>Peak Load</span>
              <span className="font-bold">
                {dailyUsage?.reduce(
                  (max, d) => (d.gb_used > max.gb_used ? d : max),
                  { date: "N/A", gb_used: 0 },
                ).date || "N/A"}
              </span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

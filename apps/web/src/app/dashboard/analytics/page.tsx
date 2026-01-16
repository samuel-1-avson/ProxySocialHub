'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth, fetchWithAuth } from '@/lib/auth';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

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
  cost_ghs: number;
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
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Simple bar chart
function BarChart({ data, label }: { data: DailyUsagePoint[]; label: string }) {
  const maxValue = Math.max(...data.map(d => d.gb_used), 0.01);
  
  return (
    <div className="space-y-2">
      <div className="text-gray-400 text-sm">{label}</div>
      <div className="flex items-end h-40 gap-2">
        {data.map((point, index) => {
          const height = (point.gb_used / maxValue) * 100;
          return (
            <div key={index} className="flex-1 flex flex-col items-center">
              <div
                className="w-full bg-gradient-to-t from-orange-600 to-orange-400 rounded-t transition-all duration-300 hover:opacity-80 cursor-pointer"
                style={{ height: `${Math.max(height, 2)}%` }}
                title={`${point.date}: ${point.gb_used.toFixed(3)} GB`}
              />
              <div className="text-xs text-gray-500 mt-1 truncate w-full text-center">
                {point.date.slice(5)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Geo distribution chart
function GeoChart({ data }: { data: GeoStats[] }) {
  const total = data.reduce((sum, d) => sum + d.request_count, 0) || 1;
  const colors = ['#f97316', '#22c55e', '#3b82f6', '#a855f7', '#f43f5e'];
  
  return (
    <div className="space-y-3">
      {data.map((geo, index) => {
        const percent = (geo.request_count / total) * 100;
        return (
          <div key={geo.country_code} className="space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-white">{geo.country_name}</span>
              <span className="text-gray-400">{percent.toFixed(1)}%</span>
            </div>
            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
              <div 
                className="h-full rounded-full transition-all"
                style={{ width: `${percent}%`, backgroundColor: colors[index % colors.length] }}
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
  const router = useRouter();
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [dailyUsage, setDailyUsage] = useState<DailyUsagePoint[]>([]);
  const [geoData, setGeoData] = useState<GeoStats[]>([]);
  const [destinations, setDestinations] = useState<DestinationStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [days, setDays] = useState(7);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }

    if (isAuthenticated) {
      loadAnalytics();
    }
  }, [isLoading, isAuthenticated, router, days]);

  const loadAnalytics = async () => {
    try {
      setLoading(true);
      const [overviewRes, dailyRes, geoRes, destRes] = await Promise.all([
        fetchWithAuth(`${API_BASE_URL}/v1/analytics/overview`).then(r => r.json()).catch(() => null),
        fetchWithAuth(`${API_BASE_URL}/v1/analytics/usage/daily?days=${days}`).then(r => r.json()).catch(() => ({ data: [] })),
        fetchWithAuth(`${API_BASE_URL}/v1/analytics/geo`).then(r => r.json()).catch(() => ({ data: [] })),
        fetchWithAuth(`${API_BASE_URL}/v1/analytics/top-destinations`).then(r => r.json()).catch(() => ({ data: [] })),
      ]);

      setOverview(overviewRes);
      setDailyUsage(dailyRes.data || []);
      setGeoData(geoRes.data || []);
      setDestinations(destRes.data || []);
    } catch (err) {
      setError('Failed to load analytics');
    } finally {
      setLoading(false);
    }
  };

  if (isLoading || loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white">Loading analytics...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Header */}
      <header className="bg-gray-800/50 border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="flex items-center gap-2">
              <span className="text-xl">🌐</span>
              <span className="font-bold text-white">ProxyHub</span>
            </Link>
            <span className="text-gray-500 text-sm">/ Analytics</span>
          </div>
          <Link href="/dashboard" className="text-gray-400 hover:text-white transition text-sm">
            ← Back to Dashboard
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        {/* Overview Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard 
            label="Total Bandwidth" 
            value={`${overview?.total_bandwidth_gb?.toFixed(2) || '0.00'} GB`}
            icon="📊"
          />
          <StatCard 
            label="Success Rate" 
            value={`${((overview?.success_rate || 0) * 100).toFixed(1)}%`}
            icon="✅"
            color="green"
          />
          <StatCard 
            label="Avg Latency" 
            value={`${overview?.avg_latency_ms || 0} ms`}
            icon="⚡"
            color="yellow"
          />
          <StatCard 
            label="Active Sessions" 
            value={overview?.active_sessions || 0}
            icon="🔌"
            color="blue"
          />
        </div>

        {/* Time Range Selector */}
        <div className="flex gap-2 mb-6">
          {[7, 14, 30].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                days === d 
                  ? 'bg-orange-500 text-white' 
                  : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              {d} Days
            </button>
          ))}
        </div>

        {/* Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Daily Usage Chart */}
          <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
            <h3 className="text-lg font-semibold text-white mb-4">📈 Daily Bandwidth Usage</h3>
            {dailyUsage.length > 0 ? (
              <BarChart data={dailyUsage} label="GB per day" />
            ) : (
              <div className="h-40 flex items-center justify-center text-gray-400">
                No usage data available
              </div>
            )}
          </div>

          {/* Geo Distribution */}
          <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
            <h3 className="text-lg font-semibold text-white mb-4">🌍 Traffic by Country</h3>
            {geoData.length > 0 ? (
              <GeoChart data={geoData} />
            ) : (
              <div className="h-40 flex items-center justify-center text-gray-400">
                No geo data available
              </div>
            )}
          </div>
        </div>

        {/* Top Destinations */}
        <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-700">
            <h3 className="text-lg font-semibold text-white">🎯 Top Destinations</h3>
          </div>
          {destinations.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-900/50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Domain</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Requests</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Data</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Latency</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/50">
                  {destinations.map((dest, index) => (
                    <tr key={dest.domain} className="hover:bg-gray-800/30">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className="text-orange-400">#{index + 1}</span>
                          <span className="text-white font-mono">{dest.domain}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-gray-300">{dest.request_count.toLocaleString()}</td>
                      <td className="px-6 py-4 text-gray-300">{formatBytes(dest.bytes_used)}</td>
                      <td className="px-6 py-4">
                        <span className={`${dest.avg_latency_ms < 50 ? 'text-green-400' : dest.avg_latency_ms < 100 ? 'text-yellow-400' : 'text-red-400'}`}>
                          {dest.avg_latency_ms} ms
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-8 text-center text-gray-400">
              No destination data available yet
            </div>
          )}
        </div>

        {/* Quick Insights */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-gradient-to-r from-green-500/10 to-emerald-500/10 rounded-xl p-6 border border-green-500/20">
            <h3 className="text-lg font-semibold text-white mb-3">💡 Performance Insights</h3>
            <ul className="space-y-2 text-gray-300 text-sm">
              <li>• Top performing country: <strong className="text-white">{overview?.top_country || 'GH'}</strong></li>
              <li>• Primary ISP: <strong className="text-white">{overview?.top_isp || 'MTN Ghana'}</strong></li>
              <li>• Unique destinations: <strong className="text-white">{overview?.unique_destinations || 0}</strong></li>
            </ul>
          </div>
          <div className="bg-gradient-to-r from-orange-500/10 to-amber-500/10 rounded-xl p-6 border border-orange-500/20">
            <h3 className="text-lg font-semibold text-white mb-3">📊 Usage Summary</h3>
            <ul className="space-y-2 text-gray-300 text-sm">
              <li>• Total cost this period: <strong className="text-white">₵{(dailyUsage.reduce((sum, d) => sum + d.cost_ghs, 0)).toFixed(2)}</strong></li>
              <li>• Average daily usage: <strong className="text-white">{(dailyUsage.reduce((sum, d) => sum + d.gb_used, 0) / (dailyUsage.length || 1)).toFixed(3)} GB</strong></li>
              <li>• Peak day: <strong className="text-white">{dailyUsage.reduce((max, d) => d.gb_used > max.gb_used ? d : max, { date: 'N/A', gb_used: 0 }).date}</strong></li>
            </ul>
          </div>
        </div>
      </main>
    </div>
  );
}

function StatCard({ label, value, icon, color = 'gray' }: { label: string; value: string | number; icon: string; color?: string }) {
  const colorClasses: Record<string, string> = {
    gray: 'bg-gray-800/50 border-gray-700/50',
    green: 'bg-green-500/10 border-green-500/30',
    blue: 'bg-blue-500/10 border-blue-500/30',
    yellow: 'bg-yellow-500/10 border-yellow-500/30',
    orange: 'bg-orange-500/10 border-orange-500/30',
  };

  return (
    <div className={`rounded-xl p-6 border ${colorClasses[color]}`}>
      <div className="flex items-center gap-3">
        <span className="text-2xl">{icon}</span>
        <div>
          <div className="text-gray-400 text-xs">{label}</div>
          <div className="text-xl font-bold text-white">{value}</div>
        </div>
      </div>
    </div>
  );
}

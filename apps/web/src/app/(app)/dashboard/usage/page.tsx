'use client';

import { useEffect, useState } from 'react';
import { getSessions, getSessionUsage, Session, UsageStats } from '@/lib/api';

interface SessionWithUsage extends Session {
  usage?: UsageStats;
}

export default function UsagePage() {
  const [sessions, setSessions] = useState<SessionWithUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalUsage, setTotalUsage] = useState({ gb: 0, cost: 0 });

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    try {
      const sessionsData = await getSessions();
      
      // Fetch usage for each session
      const sessionsWithUsage = await Promise.all(
        sessionsData.map(async (session) => {
          try {
            const usage = await getSessionUsage(session.credentials_user);
            return { ...session, usage };
          } catch {
            return session;
          }
        })
      );

      setSessions(sessionsWithUsage as SessionWithUsage[]);

      // Calculate totals
      const totals = (sessionsWithUsage as SessionWithUsage[]).reduce(
        (acc, s) => ({
          gb: acc.gb + (s.usage?.gb_used || 0),
          cost: acc.cost + (s.usage?.cost_ghs || 0),
        }),
        { gb: 0, cost: 0 }
      );
      setTotalUsage(totals);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-orange-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white">Usage</h1>
        <p className="text-gray-400 mt-1">Monitor your bandwidth consumption</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gradient-to-br from-purple-500/20 to-pink-500/20 backdrop-blur-sm rounded-2xl p-6 border border-purple-500/30">
          <p className="text-gray-400 text-sm">Total Usage</p>
          <p className="text-3xl font-bold text-white mt-1">{totalUsage.gb.toFixed(3)} GB</p>
        </div>
        <div className="bg-gradient-to-br from-orange-500/20 to-amber-500/20 backdrop-blur-sm rounded-2xl p-6 border border-orange-500/30">
          <p className="text-gray-400 text-sm">Total Cost</p>
          <p className="text-3xl font-bold text-white mt-1">GHS {totalUsage.cost.toFixed(2)}</p>
        </div>
        <div className="bg-gradient-to-br from-green-500/20 to-emerald-500/20 backdrop-blur-sm rounded-2xl p-6 border border-green-500/30">
          <p className="text-gray-400 text-sm">Active Sessions</p>
          <p className="text-3xl font-bold text-white mt-1">
            {sessions.filter((s) => s.status === 'active').length}
          </p>
        </div>
      </div>

      {/* Sessions Usage Table */}
      <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl p-6 border border-gray-700/50">
        <h2 className="text-xl font-semibold text-white mb-4">Usage by Session</h2>
        {sessions.length === 0 ? (
          <p className="text-gray-400">No sessions found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-gray-400 text-sm border-b border-gray-700">
                  <th className="pb-3">Session</th>
                  <th className="pb-3">Type</th>
                  <th className="pb-3">Status</th>
                  <th className="pb-3">Usage</th>
                  <th className="pb-3">Limit</th>
                  <th className="pb-3">Progress</th>
                  <th className="pb-3">Cost</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => {
                  const usage = session.usage;
                  const percentUsed = usage?.percent_used || 0;

                  return (
                    <tr key={session.id} className="border-b border-gray-700/50">
                      <td className="py-4 text-white font-mono text-sm">
                        {session.id.slice(0, 8)}...
                      </td>
                      <td className="py-4 text-white capitalize">{session.type}</td>
                      <td className="py-4">
                        <span
                          className={`px-2 py-1 rounded-full text-xs ${
                            session.status === 'active'
                              ? 'bg-green-500/20 text-green-400'
                              : 'bg-gray-500/20 text-gray-400'
                          }`}
                        >
                          {session.status}
                        </span>
                      </td>
                      <td className="py-4 text-white">
                        {usage?.gb_used?.toFixed(3) || '0.000'} GB
                      </td>
                      <td className="py-4 text-gray-400">
                        {((usage?.bytes_limit || 0) / (1024 * 1024 * 1024)).toFixed(1)} GB
                      </td>
                      <td className="py-4">
                        <div className="w-32 h-2 bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all ${
                              percentUsed > 80 ? 'bg-red-500' : percentUsed > 50 ? 'bg-yellow-500' : 'bg-green-500'
                            }`}
                            style={{ width: `${Math.min(percentUsed, 100)}%` }}
                          />
                        </div>
                        <p className="text-xs text-gray-500 mt-1">{percentUsed.toFixed(1)}%</p>
                      </td>
                      <td className="py-4 text-orange-400 font-medium">
                        GHS {usage?.cost_ghs?.toFixed(2) || '0.00'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Usage Tips */}
      <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl p-6 border border-gray-700/50">
        <h2 className="text-xl font-semibold text-white mb-4">💡 Tips to Reduce Usage</h2>
        <ul className="space-y-3 text-gray-300">
          <li className="flex items-start">
            <span className="text-green-400 mr-2">✓</span>
            Use rotating sessions for high-volume scraping to distribute load
          </li>
          <li className="flex items-start">
            <span className="text-green-400 mr-2">✓</span>
            Enable compression in your client to reduce data transfer
          </li>
          <li className="flex items-start">
            <span className="text-green-400 mr-2">✓</span>
            Terminate unused sessions to prevent unnecessary bandwidth usage
          </li>
          <li className="flex items-start">
            <span className="text-green-400 mr-2">✓</span>
            Monitor usage regularly and set bandwidth limits per session
          </li>
        </ul>
      </div>
    </div>
  );
}

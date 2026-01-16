'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, fetchWithAuth } from '@/lib/auth';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

interface SystemStats {
  total_users: number;
  total_providers: number;
  total_buyers: number;
  total_sessions: number;
  active_sessions: number;
  total_nodes: number;
  online_nodes: number;
  total_revenue_ghs: number;
  pending_kyc: number;
}

interface DashboardStats {
  total_users: number;
  new_users_today: number;
  new_users_week: number;
  active_users: number;
  suspended_users: number;
  active_sessions: number;
  sessions_today: number;
  online_nodes: number;
  total_nodes: number;
  healthy_percent: number;
  today_revenue_ghs: number;
  week_revenue_ghs: number;
  month_revenue_ghs: number;
  pending_kyc: number;
  approved_kyc: number;
  total_kyc: number;
}

interface User {
  id: string;
  email: string;
  role: string;
  status: string;
  trust_tier: string;
  created_at: string;
}

interface PendingPayout {
  user_id: string;
  email: string;
  earnings_ghs: number;
}

interface KYCVerification {
  id: string;
  user_id: string;
  status: string;
  created_at: string;
}

interface AuditLog {
  id: string;
  actor_email: string;
  action: string;
  entity_type: string;
  entity_id: string;
  ip_address: string;
  created_at: string;
  details: Record<string, unknown>;
}

interface NodeHealth {
  id: string;
  ip_address: string;
  country_code: string;
  is_healthy: boolean;
  latency_ms: number;
  last_seen_at: string;
  success_rate: number;
}

interface HealthStats {
  total_nodes: number;
  healthy_nodes: number;
  unhealthy_nodes: number;
  healthy_percent: number;
  avg_latency_ms: number;
}

type TabType = 'overview' | 'users' | 'kyc' | 'payouts' | 'audit' | 'health';

export default function AdminPage() {
  const { user, isLoading, isAuthenticated } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [payouts, setPayouts] = useState<PendingPayout[]>([]);
  const [kycVerifications, setKycVerifications] = useState<KYCVerification[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [healthStats, setHealthStats] = useState<HealthStats | null>(null);
  const [nodes, setNodes] = useState<NodeHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }

    if (isAuthenticated && user?.role !== 'admin') {
      router.push('/dashboard');
      return;
    }

    if (isAuthenticated) {
      loadData();
    }
  }, [isLoading, isAuthenticated, user, router]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [statsRes, dashRes, usersRes, payoutsRes, kycRes, auditRes, healthRes, nodesRes] = await Promise.all([
        fetchWithAuth(`${API_BASE_URL}/v1/admin/stats`).then(r => r.json()).catch(() => null),
        fetchWithAuth(`${API_BASE_URL}/v1/admin/stats/dashboard`).then(r => r.json()).catch(() => null),
        fetchWithAuth(`${API_BASE_URL}/v1/admin/users`).then(r => r.json()).catch(() => ({ users: [] })),
        fetchWithAuth(`${API_BASE_URL}/v1/admin/payouts/pending`).then(r => r.json()).catch(() => ({ payouts: [] })),
        fetchWithAuth(`${API_BASE_URL}/v1/admin/kyc/pending`).then(r => r.json()).catch(() => ({ verifications: [] })),
        fetchWithAuth(`${API_BASE_URL}/v1/admin/audit-logs?per_page=50`).then(r => r.json()).catch(() => ({ audit_logs: [] })),
        fetchWithAuth(`${API_BASE_URL}/v1/admin/health/stats`).then(r => r.json()).catch(() => null),
        fetchWithAuth(`${API_BASE_URL}/v1/admin/health/nodes`).then(r => r.json()).catch(() => ({ nodes: [] })),
      ]);

      setStats(statsRes);
      setDashboardStats(dashRes);
      setUsers(usersRes.users || []);
      setPayouts(payoutsRes.payouts || []);
      setKycVerifications(kycRes.verifications || []);
      setAuditLogs(auditRes.audit_logs || []);
      setHealthStats(healthRes);
      setNodes(nodesRes.nodes || []);
    } catch {
      setError('Failed to load admin data');
    } finally {
      setLoading(false);
    }
  };

  const handleBanUser = async (userId: string) => {
    try {
      await fetchWithAuth(`${API_BASE_URL}/v1/admin/users/${userId}/ban`, { method: 'POST' });
      await loadData();
    } catch {
      setError('Failed to ban user');
    }
  };

  const handleUnbanUser = async (userId: string) => {
    try {
      await fetchWithAuth(`${API_BASE_URL}/v1/admin/users/${userId}/unban`, { method: 'POST' });
      await loadData();
    } catch {
      setError('Failed to unban user');
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleSuspendUser = async (userId: string) => {
    try {
      await fetchWithAuth(`${API_BASE_URL}/v1/admin/users/${userId}/suspend`, { method: 'POST' });
      await loadData();
    } catch {
      setError('Failed to suspend user');
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleActivateUser = async (userId: string) => {
    try {
      await fetchWithAuth(`${API_BASE_URL}/v1/admin/users/${userId}/activate`, { method: 'POST' });
      await loadData();
    } catch {
      setError('Failed to activate user');
    }
  };

  const handleApproveKYC = async (verificationId: string) => {
    try {
      await fetchWithAuth(`${API_BASE_URL}/v1/admin/kyc/${verificationId}/approve`, { method: 'POST' });
      await loadData();
    } catch {
      setError('Failed to approve KYC');
    }
  };

  const handleRejectKYC = async (verificationId: string) => {
    try {
      await fetchWithAuth(`${API_BASE_URL}/v1/admin/kyc/${verificationId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Rejected by admin' }),
      });
      await loadData();
    } catch {
      setError('Failed to reject KYC');
    }
  };

  const handleNodeHealthCheck = async (nodeId: string) => {
    try {
      await fetchWithAuth(`${API_BASE_URL}/v1/admin/health/nodes/${nodeId}/check`, { method: 'POST' });
      await loadData();
    } catch {
      setError('Failed to check node health');
    }
  };

  const handleNodeReactivate = async (nodeId: string) => {
    try {
      await fetchWithAuth(`${API_BASE_URL}/v1/admin/health/nodes/${nodeId}/reactivate`, { method: 'POST' });
      await loadData();
    } catch {
      setError('Failed to reactivate node');
    }
  };

  if (isLoading || loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white">Loading Admin Console...</div>
      </div>
    );
  }

  const tabs: { id: TabType; label: string; icon: string }[] = [
    { id: 'overview', label: 'Overview', icon: '📊' },
    { id: 'users', label: 'Users', icon: '👥' },
    { id: 'kyc', label: 'KYC', icon: '✓' },
    { id: 'payouts', label: 'Payouts', icon: '💰' },
    { id: 'audit', label: 'Audit Logs', icon: '📝' },
    { id: 'health', label: 'Health', icon: '❤️' },
  ];

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Header */}
      <header className="bg-gray-800/50 border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="text-xl">🌐</span>
            <span className="font-bold text-white">ProxyHub Admin</span>
          </div>
          <span className="px-3 py-1 bg-red-500/20 text-red-400 rounded-full text-sm">Admin</span>
        </div>
      </header>

      {/* Tabs */}
      <div className="max-w-7xl mx-auto px-6 py-4">
        <div className="flex gap-2 border-b border-gray-700 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 font-medium whitespace-nowrap flex items-center gap-2 ${activeTab === tab.id
                ? 'text-orange-500 border-b-2 border-orange-500'
                : 'text-gray-400 hover:text-white'
                }`}
            >
              <span>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="max-w-7xl mx-auto px-6">
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg flex justify-between">
            {error}
            <button onClick={() => setError('')}>×</button>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Overview Tab */}
        {activeTab === 'overview' && (dashboardStats || stats) && (
          <div className="space-y-8">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Total Users" value={dashboardStats?.total_users || stats?.total_users || 0} />
              <StatCard label="New Today" value={dashboardStats?.new_users_today || 0} color="green" />
              <StatCard label="New This Week" value={dashboardStats?.new_users_week || 0} color="blue" />
              <StatCard label="Active Sessions" value={dashboardStats?.active_sessions || stats?.active_sessions || 0} color="orange" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Online Nodes" value={`${dashboardStats?.online_nodes || stats?.online_nodes || 0}/${dashboardStats?.total_nodes || stats?.total_nodes || 0}`} color="green" />
              <StatCard label="Node Health" value={`${(dashboardStats?.healthy_percent || 0).toFixed(1)}%`} color="green" />
              <StatCard label="Pending KYC" value={dashboardStats?.pending_kyc || stats?.pending_kyc || 0} color="yellow" />
              <StatCard label="Today Revenue" value={`₵${(dashboardStats?.today_revenue_ghs || 0).toFixed(2)}`} color="orange" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <StatCard label="Week Revenue" value={`₵${(dashboardStats?.week_revenue_ghs || 0).toFixed(2)}`} color="blue" />
              <StatCard label="Month Revenue" value={`₵${(dashboardStats?.month_revenue_ghs || 0).toFixed(2)}`} color="orange" />
              <StatCard label="Total Revenue" value={`₵${(stats?.total_revenue_ghs || 0).toFixed(2)}`} color="green" />
            </div>
          </div>
        )}

        {/* Users Tab */}
        {activeTab === 'users' && (
          <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-700 flex justify-between items-center">
              <h2 className="text-lg font-semibold text-white">User Management</h2>
              <span className="text-gray-400">{users.length} users</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-900/50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Email</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Role</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Tier</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/50">
                  {users.map(user => (
                    <tr key={user.id}>
                      <td className="px-6 py-4 text-white">{user.email}</td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 rounded text-xs ${user.role === 'admin' ? 'bg-red-500/20 text-red-400' :
                          user.role === 'provider' ? 'bg-green-500/20 text-green-400' :
                            'bg-blue-500/20 text-blue-400'
                          }`}>{user.role}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 rounded text-xs ${user.status === 'active' ? 'bg-green-500/20 text-green-400' :
                          user.status === 'banned' ? 'bg-red-500/20 text-red-400' :
                            'bg-gray-500/20 text-gray-400'
                          }`}>{user.status}</span>
                      </td>
                      <td className="px-6 py-4 text-gray-300">{user.trust_tier}</td>
                      <td className="px-6 py-4">
                        {user.status === 'banned' ? (
                          <button onClick={() => handleUnbanUser(user.id)} className="text-green-400 hover:text-green-300 text-sm">
                            Unban
                          </button>
                        ) : (
                          <button onClick={() => handleBanUser(user.id)} className="text-red-400 hover:text-red-300 text-sm">
                            Ban
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* KYC Tab */}
        {activeTab === 'kyc' && (
          <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-700">
              <h2 className="text-lg font-semibold text-white">Pending KYC Verifications</h2>
            </div>
            {kycVerifications.length === 0 ? (
              <div className="p-8 text-center text-gray-400">No pending KYC verifications</div>
            ) : (
              <div className="divide-y divide-gray-700/50">
                {kycVerifications.map(kyc => (
                  <div key={kyc.id} className="px-6 py-4 flex items-center justify-between">
                    <div>
                      <div className="text-white">{kyc.user_id}</div>
                      <div className="text-gray-400 text-sm">{new Date(kyc.created_at).toLocaleString()}</div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleApproveKYC(kyc.id)}
                        className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleRejectKYC(kyc.id)}
                        className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Payouts Tab */}
        {activeTab === 'payouts' && (
          <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-700">
              <h2 className="text-lg font-semibold text-white">Pending Provider Payouts</h2>
            </div>
            {payouts.length === 0 ? (
              <div className="p-8 text-center text-gray-400">No pending payouts</div>
            ) : (
              <div className="divide-y divide-gray-700/50">
                {payouts.map(payout => (
                  <div key={payout.user_id} className="px-6 py-4 flex items-center justify-between">
                    <div>
                      <div className="text-white">{payout.email}</div>
                      <div className="text-gray-400 text-sm">ID: {payout.user_id}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-green-400 font-medium">₵{payout.earnings_ghs.toFixed(2)}</div>
                      <button className="text-orange-400 hover:text-orange-300 text-sm">
                        Process Payout
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Audit Logs Tab */}
        {activeTab === 'audit' && (
          <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-700 flex justify-between items-center">
              <h2 className="text-lg font-semibold text-white">Audit Logs</h2>
              <span className="text-gray-400">{auditLogs.length} entries</span>
            </div>
            {auditLogs.length === 0 ? (
              <div className="p-8 text-center text-gray-400">No audit logs yet</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-900/50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Time</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Actor</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Action</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Entity</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">IP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700/50">
                    {auditLogs.map(log => (
                      <tr key={log.id}>
                        <td className="px-6 py-4 text-gray-400 text-sm">
                          {new Date(log.created_at).toLocaleString()}
                        </td>
                        <td className="px-6 py-4 text-white">{log.actor_email || 'System'}</td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-1 rounded text-xs ${log.action.includes('ban') || log.action.includes('reject') ? 'bg-red-500/20 text-red-400' :
                            log.action.includes('approve') || log.action.includes('activate') ? 'bg-green-500/20 text-green-400' :
                              'bg-blue-500/20 text-blue-400'
                            }`}>{log.action}</span>
                        </td>
                        <td className="px-6 py-4 text-gray-300">
                          <span className="capitalize">{log.entity_type}</span>
                          {log.entity_id && <span className="text-gray-500 text-sm ml-1">#{log.entity_id.slice(0, 8)}</span>}
                        </td>
                        <td className="px-6 py-4 text-gray-400 text-sm font-mono">{log.ip_address || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Health Monitoring Tab */}
        {activeTab === 'health' && (
          <div className="space-y-6">
            {/* Health Stats Cards */}
            {healthStats && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <StatCard label="Total Nodes" value={healthStats.total_nodes} />
                <StatCard label="Healthy" value={healthStats.healthy_nodes} color="green" />
                <StatCard label="Unhealthy" value={healthStats.unhealthy_nodes} color="orange" />
                <StatCard label="Health %" value={`${healthStats.healthy_percent.toFixed(1)}%`} color="green" />
                <StatCard label="Avg Latency" value={`${healthStats.avg_latency_ms.toFixed(0)}ms`} color="blue" />
              </div>
            )}

            {/* Nodes Table */}
            <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-700 flex justify-between items-center">
                <h2 className="text-lg font-semibold text-white">Node Health Status</h2>
                <span className="text-gray-400">{nodes.length} nodes</span>
              </div>
              {nodes.length === 0 ? (
                <div className="p-8 text-center text-gray-400">No nodes registered</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-900/50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Status</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">IP Address</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Location</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Latency</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Success Rate</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Last Seen</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700/50">
                      {nodes.map(node => (
                        <tr key={node.id}>
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center gap-2 px-2 py-1 rounded text-xs ${node.is_healthy ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                              }`}>
                              <span className={`w-2 h-2 rounded-full ${node.is_healthy ? 'bg-green-400' : 'bg-red-400'}`}></span>
                              {node.is_healthy ? 'Healthy' : 'Unhealthy'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-white font-mono text-sm">{node.ip_address || '-'}</td>
                          <td className="px-6 py-4 text-gray-300">{node.country_code || '-'}</td>
                          <td className="px-6 py-4">
                            <span className={`text-sm ${node.latency_ms < 100 ? 'text-green-400' :
                              node.latency_ms < 300 ? 'text-yellow-400' : 'text-red-400'
                              }`}>{node.latency_ms}ms</span>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`text-sm ${node.success_rate >= 0.95 ? 'text-green-400' :
                              node.success_rate >= 0.8 ? 'text-yellow-400' : 'text-red-400'
                              }`}>{(node.success_rate * 100).toFixed(1)}%</span>
                          </td>
                          <td className="px-6 py-4 text-gray-400 text-sm">
                            {node.last_seen_at ? new Date(node.last_seen_at).toLocaleString() : '-'}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleNodeHealthCheck(node.id)}
                                className="text-blue-400 hover:text-blue-300 text-sm"
                              >
                                Check
                              </button>
                              {!node.is_healthy && (
                                <button
                                  onClick={() => handleNodeReactivate(node.id)}
                                  className="text-green-400 hover:text-green-300 text-sm"
                                >
                                  Reactivate
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function StatCard({ label, value, color = 'gray' }: { label: string; value: string | number; color?: string }) {
  const colorClasses = {
    gray: 'bg-gray-800/50 border-gray-700/50',
    green: 'bg-green-500/10 border-green-500/30',
    blue: 'bg-blue-500/10 border-blue-500/30',
    orange: 'bg-orange-500/10 border-orange-500/30',
    yellow: 'bg-yellow-500/10 border-yellow-500/30',
  };

  return (
    <div className={`rounded-xl p-6 border ${colorClasses[color as keyof typeof colorClasses]}`}>
      <div className="text-gray-400 text-sm">{label}</div>
      <div className="text-2xl font-bold text-white mt-1">{value}</div>
    </div>
  );
}

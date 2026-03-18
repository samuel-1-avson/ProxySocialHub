"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, fetchWithAuth } from '@/lib/auth';
import { LayoutDashboard, Users, FileText, ShieldCheck, CreditCard, Activity, HeartPulse, ExternalLink, Ban, CheckCircle, XCircle, AlertTriangle, Search, Filter } from 'lucide-react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8081';

interface SystemStats {
    total_users: number;
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
    active_sessions: number;
    online_nodes: number;
    total_nodes: number;
    healthy_percent: number;
    today_revenue_ghs: number;
    week_revenue_ghs: number;
    month_revenue_ghs: number;
    pending_kyc: number;
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


interface ProviderApplication {
    id: string;
    user_id: string;
    status: string;
    reason: string;
    isp: string;
    location: string;
    bandwidth: string;
    created_at: string;
    user?: User;
}

type TabType = 'overview' | 'users' | 'applications' | 'kyc' | 'payouts' | 'audit' | 'health';

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
    const [applications, setApplications] = useState<ProviderApplication[]>([]);
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
            const [statsRes, dashRes, usersRes, payoutsRes, kycRes, auditRes, healthRes, nodesRes, appsRes] = await Promise.all([
                fetchWithAuth(`${API_BASE_URL}/v1/admin/stats`).then(r => r.json()).catch(() => null),
                fetchWithAuth(`${API_BASE_URL}/v1/admin/stats/dashboard`).then(r => r.json()).catch(() => null),
                fetchWithAuth(`${API_BASE_URL}/v1/admin/users`).then(r => r.json()).catch(() => ({ users: [] })),
                fetchWithAuth(`${API_BASE_URL}/v1/admin/payouts/pending`).then(r => r.json()).catch(() => ({ payouts: [] })),
                fetchWithAuth(`${API_BASE_URL}/v1/admin/kyc/pending`).then(r => r.json()).catch(() => ({ verifications: [] })),
                fetchWithAuth(`${API_BASE_URL}/v1/admin/audit-logs?per_page=50`).then(r => r.json()).catch(() => ({ audit_logs: [] })),
                fetchWithAuth(`${API_BASE_URL}/v1/admin/health/stats`).then(r => r.json()).catch(() => null),
                fetchWithAuth(`${API_BASE_URL}/v1/admin/health/nodes`).then(r => r.json()).catch(() => ({ nodes: [] })),
                fetchWithAuth(`${API_BASE_URL}/v1/admin/provider/applications?status=pending`).then(r => r.json()).catch(() => ({ applications: [] })),
            ]);

            setStats(statsRes);
            setDashboardStats(dashRes);
            setUsers(usersRes.users || []);
            setPayouts(payoutsRes.payouts || []);
            setKycVerifications(kycRes.verifications || []);
            setAuditLogs(auditRes.audit_logs || []);
            setHealthStats(healthRes);
            setNodes(nodesRes.nodes || []);
            setApplications(appsRes?.applications || []);
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

    const handleApproveApplication = async (appId: string) => {
        try {
            await fetchWithAuth(`${API_BASE_URL}/v1/admin/provider/applications/${appId}/approve`, { method: 'POST' });
            await loadData();
        } catch {
            setError('Failed to approve application');
        }
    };

    const handleRejectApplication = async (appId: string) => {
        try {
            await fetchWithAuth(`${API_BASE_URL}/v1/admin/provider/applications/${appId}/reject`, { method: 'POST' });
            await loadData();
        } catch {
            setError('Failed to reject application');
        }
    };

    if (isLoading || loading) {
        return (
            <div className="flex flex-col items-center justify-center py-40 gap-4">
                <div className="w-8 h-8 rounded-sm bg-primary animate-spin"></div>
                <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Initializing Admin Matrix...</p>
            </div>
        );
    }

    const tabs: { id: TabType; label: string; icon: any }[] = [
        { id: 'overview', label: 'Overview', icon: LayoutDashboard },
        { id: 'users', label: 'Users', icon: Users },
        { id: 'applications', label: 'Applications', icon: FileText },
        { id: 'kyc', label: 'KYC', icon: ShieldCheck },
        { id: 'payouts', label: 'Payouts', icon: CreditCard },
        { id: 'audit', label: 'Audit Logs', icon: Activity },
        { id: 'health', label: 'Health', icon: HeartPulse },
    ];

    return (
        <div className="space-y-8 animate-in fade-in duration-500 pb-20">
            {/* Header */}
            <div className="flex flex-col gap-2 border-b border-border pb-6">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-destructive font-mono text-xs font-bold uppercase tracking-widest">
                        <ShieldCheck size={14} />
                        Restricted Access Area
                    </div>
                    <span className="px-2 py-0.5 bg-destructive/10 text-destructive border border-destructive/20 rounded-sm text-[10px] font-mono font-bold uppercase">
                        Admin Privileges Active
                    </span>
                </div>
                <h1 className="text-3xl font-bold font-mono uppercase tracking-tight">System Administration</h1>
                <p className="text-muted-foreground font-mono text-xs max-w-lg">
                    OVERSEE NETWORK OPERATIONS, USER MANAGEMENT, AND SYSTEM INTEGRITY.
                </p>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                {tabs.map(tab => {
                    const Icon = tab.icon;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`btn-retro btn-retro-sm whitespace-nowrap flex items-center gap-2 ${activeTab === tab.id
                                ? 'btn-retro-primary'
                                : 'btn-retro-outline bg-background'
                                }`}
                        >
                            <Icon size={14} />
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            {error && (
                <div className="card-retro p-4 bg-destructive/10 border-destructive/20 text-destructive flex justify-between items-center text-xs font-mono">
                    <span>ERROR: {error}</span>
                    <button onClick={() => setError('')}><XCircle size={14} /></button>
                </div>
            )}

            {/* Overview Tab */}
            {activeTab === 'overview' && (dashboardStats || stats) && (
                <div className="space-y-8 animate-in slide-in-from-bottom-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <StatCard label="Total Users" value={dashboardStats?.total_users || stats?.total_users || 0} />
                        <StatCard label="New Today" value={dashboardStats?.new_users_today || 0} color="green" isIncrease />
                        <StatCard label="New This Week" value={dashboardStats?.new_users_week || 0} color="blue" isIncrease />
                        <StatCard label="Active Sessions" value={dashboardStats?.active_sessions || stats?.active_sessions || 0} color="orange" />
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <StatCard label="Online Nodes" value={`${dashboardStats?.online_nodes || stats?.online_nodes || 0}/${dashboardStats?.total_nodes || stats?.total_nodes || 0}`} color="green" />
                        <StatCard label="Node Health" value={`${(dashboardStats?.healthy_percent || 0).toFixed(1)}%`} color="green" />
                        <StatCard label="Pending KYC" value={dashboardStats?.pending_kyc || stats?.pending_kyc || 0} color="yellow" />
                        <StatCard label="Today Revenue" value={`₵${(dashboardStats?.today_revenue_ghs || 0).toFixed(2)}`} color="primary" />
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
                <div className="card-retro p-0 bg-card overflow-hidden animate-in slide-in-from-bottom-4">
                    <div className="px-6 py-4 border-b border-border bg-secondary/10 flex justify-between items-center">
                        <h2 className="text-sm font-bold font-mono uppercase flex items-center gap-2">
                            <Users size={16} /> User Management
                        </h2>
                        <span className="text-[10px] font-mono font-bold text-muted-foreground uppercase">{users.length} REGISTERED ENTITIES</span>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left font-mono text-xs">
                            <thead className="bg-secondary/20 border-b border-border">
                                <tr>
                                    <th className="px-6 py-3 font-bold text-muted-foreground uppercase">Email</th>
                                    <th className="px-6 py-3 font-bold text-muted-foreground uppercase">Role</th>
                                    <th className="px-6 py-3 font-bold text-muted-foreground uppercase">Status</th>
                                    <th className="px-6 py-3 font-bold text-muted-foreground uppercase">Tier</th>
                                    <th className="px-6 py-3 font-bold text-muted-foreground uppercase text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/50">
                                {users.map(user => (
                                    <tr key={user.id} className="hover:bg-secondary/10 transition-colors">
                                        <td className="px-6 py-4 font-bold">{user.email}</td>
                                        <td className="px-6 py-4">
                                            <span className={`px-2 py-0.5 rounded-sm border text-[10px] font-bold uppercase ${user.role === 'admin' ? 'bg-destructive/10 text-destructive border-destructive/20' :
                                                    user.role === 'provider' ? 'bg-primary/10 text-primary border-primary/20' :
                                                        'bg-secondary text-muted-foreground border-border'
                                                }`}>{user.role}</span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`px-2 py-0.5 rounded-sm border text-[10px] font-bold uppercase ${user.status === 'active' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                                                    user.status === 'banned' ? 'bg-destructive/10 text-destructive border-destructive/20' :
                                                        'bg-secondary text-muted-foreground border-border'
                                                }`}>{user.status}</span>
                                        </td>
                                        <td className="px-6 py-4 text-muted-foreground">{user.trust_tier}</td>
                                        <td className="px-6 py-4 text-right">
                                            {user.status === 'banned' ? (
                                                <button onClick={() => handleUnbanUser(user.id)} className="text-green-500 hover:underline">
                                                    UNBAN
                                                </button>
                                            ) : (
                                                <button onClick={() => handleBanUser(user.id)} className="text-destructive hover:underline">
                                                    BAN
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

            {/* Applications Tab */}
            {activeTab === 'applications' && (
                <div className="card-retro p-0 bg-card overflow-hidden animate-in slide-in-from-bottom-4">
                    <div className="px-6 py-4 border-b border-border bg-secondary/10">
                        <h2 className="text-sm font-bold font-mono uppercase flex items-center gap-2">
                            <FileText size={16} /> Pending Provider Applications
                        </h2>
                    </div>
                    {applications.length === 0 ? (
                        <div className="p-12 text-center text-muted-foreground font-mono text-xs uppercase">No pending applications found.</div>
                    ) : (
                        <div className="divide-y divide-border/50">
                            {applications.map(app => (
                                <div key={app.id} className="p-6 font-mono">
                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <h3 className="text-base font-bold uppercase">{app.user?.email || 'Unknown User'}</h3>
                                            <p className="text-[10px] text-muted-foreground">SUBMITTED: {new Date(app.created_at).toLocaleString()}</p>
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => handleApproveApplication(app.id)}
                                                className="btn-retro btn-retro-sm btn-retro-primary"
                                            >
                                                APPROVE APPLICATION
                                            </button>
                                            <button
                                                onClick={() => handleRejectApplication(app.id)}
                                                className="btn-retro btn-retro-sm bg-destructive text-destructive-foreground border-destructive/50"
                                            >
                                                REJECT
                                            </button>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                                        <div className="bg-secondary/20 p-4 rounded-sm border border-border">
                                            <p className="text-muted-foreground mb-1 uppercase text-[10px] font-bold">Reason for applying</p>
                                            <p className="italic">"{app.reason}"</p>
                                        </div>
                                        <div className="bg-secondary/20 p-4 rounded-sm border border-border space-y-2">
                                            <div className="flex justify-between border-b border-border/30 pb-1">
                                                <span className="text-muted-foreground uppercase text-[10px] font-bold">ISP</span>
                                                <span>{app.isp}</span>
                                            </div>
                                            <div className="flex justify-between border-b border-border/30 pb-1">
                                                <span className="text-muted-foreground uppercase text-[10px] font-bold">Location</span>
                                                <span>{app.location}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground uppercase text-[10px] font-bold">Bandwidth</span>
                                                <span>{app.bandwidth}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* KYC Tab */}
            {activeTab === 'kyc' && (
                <div className="card-retro p-0 bg-card overflow-hidden animate-in slide-in-from-bottom-4">
                    <div className="px-6 py-4 border-b border-border bg-secondary/10">
                        <h2 className="text-sm font-bold font-mono uppercase flex items-center gap-2">
                            <ShieldCheck size={16} /> Pending KYC Verifications
                        </h2>
                    </div>
                    {kycVerifications.length === 0 ? (
                        <div className="p-12 text-center text-muted-foreground font-mono text-xs uppercase">No pending verification requests.</div>
                    ) : (
                        <div className="divide-y divide-border/50 font-mono text-xs">
                            {kycVerifications.map(kyc => (
                                <div key={kyc.id} className="px-6 py-4 flex items-center justify-between">
                                    <div>
                                        <div className="font-bold">{kyc.user_id}</div>
                                        <div className="text-[10px] text-muted-foreground">{new Date(kyc.created_at).toLocaleString()}</div>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => handleApproveKYC(kyc.id)}
                                            className="btn-retro btn-retro-sm btn-retro-primary"
                                        >
                                            <CheckCircle size={14} /> APPROVE
                                        </button>
                                        <button
                                            onClick={() => handleRejectKYC(kyc.id)}
                                            className="btn-retro btn-retro-sm bg-destructive text-destructive-foreground border-destructive/50"
                                        >
                                            <XCircle size={14} /> REJECT
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
                <div className="card-retro p-0 bg-card overflow-hidden animate-in slide-in-from-bottom-4">
                    <div className="px-6 py-4 border-b border-border bg-secondary/10">
                        <h2 className="text-sm font-bold font-mono uppercase flex items-center gap-2">
                            <CreditCard size={16} /> Pending Payouts
                        </h2>
                    </div>
                    {payouts.length === 0 ? (
                        <div className="p-12 text-center text-muted-foreground font-mono text-xs uppercase">No pending payouts.</div>
                    ) : (
                        <div className="divide-y divide-border/50 font-mono text-xs">
                            {payouts.map(payout => (
                                <div key={payout.user_id} className="px-6 py-4 flex items-center justify-between">
                                    <div>
                                        <div className="font-bold">{payout.email}</div>
                                        <div className="text-[10px] text-muted-foreground">ID: {payout.user_id}</div>
                                    </div>
                                    <div className="text-right flex items-center gap-4">
                                        <div className="text-green-500 font-bold">₵{payout.earnings_ghs.toFixed(2)}</div>
                                        <button className="text-primary hover:underline uppercase font-bold text-[10px]">
                                            Process
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
                <div className="card-retro p-0 bg-card overflow-hidden animate-in slide-in-from-bottom-4">
                    <div className="px-6 py-4 border-b border-border bg-secondary/10 flex justify-between items-center">
                        <h2 className="text-sm font-bold font-mono uppercase flex items-center gap-2">
                            <Activity size={16} /> Audit Logs
                        </h2>
                        <span className="text-[10px] font-mono font-bold text-muted-foreground uppercase">{auditLogs.length} EVENTS</span>
                    </div>
                    {auditLogs.length === 0 ? (
                        <div className="p-12 text-center text-muted-foreground font-mono text-xs uppercase">No audit logs recorded.</div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left font-mono text-xs">
                                <thead className="bg-secondary/20 border-b border-border">
                                    <tr>
                                        <th className="px-6 py-3 font-bold text-muted-foreground uppercase">Time</th>
                                        <th className="px-6 py-3 font-bold text-muted-foreground uppercase">Actor</th>
                                        <th className="px-6 py-3 font-bold text-muted-foreground uppercase">Action</th>
                                        <th className="px-6 py-3 font-bold text-muted-foreground uppercase">Entity</th>
                                        <th className="px-6 py-3 font-bold text-muted-foreground uppercase">IP</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/50">
                                    {auditLogs.map(log => (
                                        <tr key={log.id} className="hover:bg-secondary/10 transition-colors">
                                            <td className="px-6 py-4 text-muted-foreground">
                                                {new Date(log.created_at).toLocaleString()}
                                            </td>
                                            <td className="px-6 py-4">{log.actor_email || 'SYSTEM'}</td>
                                            <td className="px-6 py-4">
                                                <span className={`px-2 py-0.5 rounded-sm border text-[10px] font-bold uppercase ${log.action.includes('ban') || log.action.includes('reject') ? 'bg-destructive/10 text-destructive border-destructive/20' :
                                                        log.action.includes('approve') || log.action.includes('activate') ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                                                            'bg-secondary text-primary border-primary/20'
                                                    }`}>{log.action}</span>
                                            </td>
                                            <td className="px-6 py-4 text-muted-foreground">
                                                <span className="capitalize text-foreground font-bold">{log.entity_type}</span>
                                                {log.entity_id && <span className="ml-1 opacity-50">#{log.entity_id.slice(0, 8)}</span>}
                                            </td>
                                            <td className="px-6 py-4 text-muted-foreground">{log.ip_address || '-'}</td>
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
                <div className="space-y-6 animate-in slide-in-from-bottom-4">
                    {/* Health Stats Cards */}
                    {healthStats && (
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                            <StatCard label="Total Nodes" value={healthStats.total_nodes} />
                            <StatCard label="Healthy" value={healthStats.healthy_nodes} color="green" />
                            <StatCard label="Unhealthy" value={healthStats.unhealthy_nodes} color="red" />
                            <StatCard label="Health %" value={`${healthStats.healthy_percent.toFixed(1)}%`} color="green" />
                            <StatCard label="Avg Latency" value={`${healthStats.avg_latency_ms.toFixed(0)}ms`} color="blue" />
                        </div>
                    )}

                    {/* Nodes Table */}
                    <div className="card-retro p-0 bg-card overflow-hidden">
                        <div className="px-6 py-4 border-b border-border bg-secondary/10 flex justify-between items-center">
                            <h2 className="text-sm font-bold font-mono uppercase flex items-center gap-2">
                                <HeartPulse size={16} /> Node Status Matrix
                            </h2>
                            <span className="text-[10px] font-mono font-bold text-muted-foreground uppercase">{nodes.length} NODES</span>
                        </div>
                        {nodes.length === 0 ? (
                            <div className="p-12 text-center text-muted-foreground font-mono text-xs uppercase">No nodes online.</div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left font-mono text-xs">
                                    <thead className="bg-secondary/20 border-b border-border">
                                        <tr>
                                            <th className="px-6 py-3 font-bold text-muted-foreground uppercase">Status</th>
                                            <th className="px-6 py-3 font-bold text-muted-foreground uppercase">IP Address</th>
                                            <th className="px-6 py-3 font-bold text-muted-foreground uppercase">Location</th>
                                            <th className="px-6 py-3 font-bold text-muted-foreground uppercase">Latency</th>
                                            <th className="px-6 py-3 font-bold text-muted-foreground uppercase">Success Rate</th>
                                            <th className="px-6 py-3 font-bold text-muted-foreground uppercase">Last Seen</th>
                                            <th className="px-6 py-3 font-bold text-muted-foreground uppercase">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/50">
                                        {nodes.map(node => (
                                            <tr key={node.id} className="hover:bg-secondary/10 transition-colors">
                                                <td className="px-6 py-4">
                                                    <span className={`inline-flex items-center gap-2 px-2 py-0.5 rounded-sm border text-[10px] font-bold uppercase ${node.is_healthy ? 'bg-green-500/10 text-green-500 border-green-500/20' : 'bg-destructive/10 text-destructive border-destructive/20'
                                                        }`}>
                                                        <span className={`w-1.5 h-1.5 rounded-full ${node.is_healthy ? 'bg-green-500 animate-pulse' : 'bg-destructive'}`}></span>
                                                        {node.is_healthy ? 'HEALTHY' : 'CRITICAL'}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 font-bold">{node.ip_address || '-'}</td>
                                                <td className="px-6 py-4 text-muted-foreground">{node.country_code || '-'}</td>
                                                <td className="px-6 py-4">
                                                    <span className={`${node.latency_ms < 100 ? 'text-green-500' :
                                                        node.latency_ms < 300 ? 'text-yellow-500' : 'text-destructive'
                                                        } font-bold`}>{node.latency_ms}ms</span>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-16 h-1.5 bg-secondary rounded-full overflow-hidden">
                                                            <div
                                                                className={`h-full ${node.success_rate >= 0.95 ? 'bg-green-500' : node.success_rate >= 0.8 ? 'bg-yellow-500' : 'bg-destructive'}`}
                                                                style={{ width: `${node.success_rate * 100}%` }}
                                                            ></div>
                                                        </div>
                                                        <span>{(node.success_rate * 100).toFixed(0)}%</span>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 text-muted-foreground">
                                                    {node.last_seen_at ? new Date(node.last_seen_at).toLocaleTimeString() : '-'}
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="flex gap-4">
                                                        <button
                                                            onClick={() => handleNodeHealthCheck(node.id)}
                                                            className="text-primary hover:underline uppercase font-bold text-[10px]"
                                                        >
                                                            PING
                                                        </button>
                                                        {!node.is_healthy && (
                                                            <button
                                                                onClick={() => handleNodeReactivate(node.id)}
                                                                className="text-green-500 hover:underline uppercase font-bold text-[10px]"
                                                            >
                                                                RESET
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
        </div>
    );
}

function StatCard({ label, value, color = 'gray', isIncrease = false }: { label: string; value: string | number; color?: string, isIncrease?: boolean }) {
    const colorClasses = {
        gray: 'text-muted-foreground border-border',
        green: 'text-green-500 border-green-500/30 bg-green-500/5',
        blue: 'text-blue-500 border-blue-500/30 bg-blue-500/5',
        orange: 'text-orange-500 border-orange-500/30 bg-orange-500/5',
        yellow: 'text-amber-500 border-amber-500/30 bg-amber-500/5',
        red: 'text-destructive border-destructive/30 bg-destructive/5',
        primary: 'text-primary border-primary/30 bg-primary/5',
    };

    return (
        <div className={`card-retro p-4 flex flex-col justify-between ${colorClasses[color as keyof typeof colorClasses]}`}>
            <div className="text-[10px] font-bold font-mono uppercase opacity-70 mb-2">{label}</div>
            <div className="flex items-end justify-between">
                <div className="text-2xl font-bold font-mono leading-none">{value}</div>
                {isIncrease && <Activity size={16} className="text-current opacity-50" />}
            </div>
        </div>
    );
}

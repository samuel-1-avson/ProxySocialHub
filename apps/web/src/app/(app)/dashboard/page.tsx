'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { getSessions, createSession, terminateSession, getWallet, Session, Wallet as WalletType } from '@/lib/api';
import {
  Wallet,
  Activity,
  Layers,
  Shield,
  RefreshCw,
  Anchor,
  CreditCard,
  Power,
  Clock,
  Key,
  AlertCircle,
  Plus
} from 'lucide-react';

export default function DashboardPage() {
  const { user, isLoading, isAuthenticated } = useAuth();
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [wallet, setWallet] = useState<WalletType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creatingSession, setCreatingSession] = useState(false);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }

    if (isAuthenticated) {
      loadData();
    }
  }, [isLoading, isAuthenticated, router]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [sessionsData, walletData] = await Promise.all([
        getSessions().catch(() => []),
        getWallet().catch(() => null),
      ]);
      setSessions(sessionsData);
      setWallet(walletData);
    } catch {
      setError('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSession = async (type: 'rotating' | 'sticky') => {
    try {
      setCreatingSession(true);
      await createSession(type);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
    } finally {
      setCreatingSession(false);
    }
  };

  const handleTerminateSession = async (sessionId: string) => {
    try {
      await terminateSession(sessionId);
      await loadData();
    } catch {
      setError('Failed to terminate session');
    }
  };

  if (isLoading || loading) {
    return (
      <div className="min-h-[400px] flex flex-col items-center justify-center space-y-4">
        <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
        <p className="text-muted-foreground font-medium animate-pulse">Initializing Dashboard...</p>
      </div>
    );
  }

  const safeSessions = Array.isArray(sessions) ? sessions : [];
  const activeSessions = safeSessions.filter(s => s.status === 'active');
  const totalSessions = sessions.length;

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-20">
      {/* Header Section */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-4xl font-black text-white tracking-tighter">Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage your active proxy protocols and sessions.</p>
        </div>
        <div className="hidden md:flex items-center gap-2 px-4 py-2 rounded-2xl bg-white/5 border border-white/10 text-xs font-bold text-muted-foreground">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
          SYSTEM ONLINE
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-2xl animate-in fade-in slide-in-from-top-4">
          <AlertCircle size={18} />
          <p className="text-sm font-medium">{error}</p>
          <button onClick={() => setError('')} className="ml-auto hover:text-white transition-colors">×</button>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: 'Wallet Balance', value: `₵${wallet?.balance?.toFixed(2) || '0.00'}`, icon: Wallet, color: 'text-primary' },
          { label: 'Active Sessions', value: activeSessions.length, icon: Activity, color: 'text-green-400' },
          { label: 'Total Sessions', value: totalSessions, icon: Layers, color: 'text-blue-400' },
          { label: 'Trust Tier', value: user?.role || 'Buyer', icon: Shield, color: 'text-orange-400' },
        ].map((stat, i) => (
          <div key={i} className="relative group p-6 rounded-3xl bg-[var(--glass-bg)] border border-[var(--glass-border)] overflow-hidden transition-all hover:border-[var(--glass-border)]/20 shadow-[var(--glass-shadow)]">
            <div className="absolute top-0 right-0 p-8 transform translate-x-4 -translate-y-4 transition-transform group-hover:translate-x-2 group-hover:-translate-y-2">
              <stat.icon className={`w-24 h-24 opacity-[0.03] ${stat.color}`} />
            </div>
            <div className="relative z-10">
              <div className="flex items-center gap-3 mb-4">
                <div className={`p-2 rounded-xl bg-white/5 border border-white/10 ${stat.color}`}>
                  <stat.icon size={18} />
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-50">{stat.label}</span>
              </div>
              <div className="text-3xl font-black text-white tracking-tighter">{stat.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="p-8 rounded-[2rem] bg-[var(--glass-bg)] border border-[var(--glass-border)] relative overflow-hidden shadow-[var(--glass-shadow)]">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent"></div>
        <div className="relative z-10">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-xl font-black text-white tracking-tight">Quick Operations</h2>
            <Link href="/dashboard/nodes" className="text-xs font-bold text-primary hover:underline">View Node Network →</Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button
              onClick={() => handleCreateSession('rotating')}
              disabled={creatingSession}
              className="group flex items-center justify-between p-4 rounded-2xl bg-orange-500/10 border border-orange-500/20 text-orange-400 hover:bg-orange-500 hover:text-white transition-all duration-300 disabled:opacity-50"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-orange-500/20 group-hover:bg-white/20">
                  <RefreshCw size={20} className={creatingSession ? 'animate-spin' : ''} />
                </div>
                <div className="text-left">
                  <div className="text-sm font-black uppercase tracking-tighter">Rotating</div>
                  <div className="text-[10px] opacity-70">Dynamic Proxy Port</div>
                </div>
              </div>
              <Plus size={18} className="opacity-50 group-hover:opacity-100" />
            </button>

            <button
              onClick={() => handleCreateSession('sticky')}
              disabled={creatingSession}
              className="group flex items-center justify-between p-4 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400 hover:bg-blue-500 hover:text-white transition-all duration-300 disabled:opacity-50"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-blue-500/20 group-hover:bg-white/20">
                  <Anchor size={20} className={creatingSession ? 'animate-pulse' : ''} />
                </div>
                <div className="text-left">
                  <div className="text-sm font-black uppercase tracking-tighter">Sticky</div>
                  <div className="text-[10px] opacity-70">Static Session Port</div>
                </div>
              </div>
              <Plus size={18} className="opacity-50 group-hover:opacity-100" />
            </button>

            <Link
              href="/dashboard/wallet"
              className="group flex items-center justify-between p-4 rounded-2xl bg-green-500/10 border border-green-500/20 text-green-400 hover:bg-green-500 hover:text-white transition-all duration-300"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-green-500/20 group-hover:bg-white/20">
                  <CreditCard size={20} />
                </div>
                <div className="text-left">
                  <div className="text-sm font-black uppercase tracking-tighter">Finance</div>
                  <div className="text-[10px] opacity-70">Top Up Balance</div>
                </div>
              </div>
              <Plus size={18} className="opacity-50 group-hover:opacity-100" />
            </Link>
          </div>
        </div>
      </div>

      {/* Sessions Table */}
      <div className="rounded-[2rem] bg-[var(--glass-bg)] border border-[var(--glass-border)] overflow-hidden shadow-[var(--glass-shadow)]">
        <div className="px-8 py-6 border-b border-white/5 flex items-center justify-between bg-white/[0.01]">
          <h2 className="text-xl font-black text-white tracking-tight">Active Protocols</h2>
          <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-50">
            {sessions.length} TOTAL SESSIONS
          </div>
        </div>

        {sessions.length === 0 ? (
          <div className="p-20 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mx-auto text-white/20">
              <Layers size={32} />
            </div>
            <div>
              <p className="text-white font-black uppercase tracking-tighter">No Active Sessions</p>
              <p className="text-muted-foreground text-sm">Deploy a new rotating or sticky session to begin.</p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-white/[0.02]">
                  <th className="px-8 py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Type</th>
                  <th className="px-8 py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Status</th>
                  <th className="px-8 py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Credentials</th>
                  <th className="px-8 py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Created</th>
                  <th className="px-8 py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground text-right">Operation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {sessions.map((session) => (
                  <tr key={session.id} className="group hover:bg-white/[0.02] transition-colors">
                    <td className="px-8 py-5">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${session.type === 'rotating' ? 'bg-orange-500/10 text-orange-400' : 'bg-blue-500/10 text-blue-400'}`}>
                          {session.type === 'rotating' ? <RefreshCw size={14} /> : <Anchor size={14} />}
                        </div>
                        <span className="text-sm font-bold text-white uppercase tracking-tighter">{session.type}</span>
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <div className="flex items-center gap-2">
                        <div className={`w-1.5 h-1.5 rounded-full ${session.status === 'active' ? 'bg-green-500' : 'bg-gray-500'}`}></div>
                        <span className="text-xs font-black uppercase tracking-widest text-white/80">{session.status}</span>
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                        <Key size={12} />
                        <span>{session.credentials_user}</span>
                        <span className="opacity-30">:</span>
                        <span className="bg-white/5 px-2 py-0.5 rounded border border-white/5">••••••••</span>
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock size={12} />
                        <span>{new Date(session.created_at).toLocaleDateString()}</span>
                      </div>
                    </td>
                    <td className="px-8 py-5 text-right">
                      {session.status === 'active' && (
                        <button
                          onClick={() => handleTerminateSession(session.id)}
                          className="p-2 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white transition-all"
                          title="Terminate Session"
                        >
                          <Power size={16} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

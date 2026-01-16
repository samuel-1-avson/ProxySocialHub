'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { getSessions, createSession, terminateSession, getWallet, Session, Wallet } from '@/lib/api';

export default function DashboardPage() {
  const { user, isLoading, isAuthenticated, logout } = useAuth();
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [wallet, setWallet] = useState<Wallet | null>(null);
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
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-foreground">Loading...</div>
      </div>
    );
  }

  const activeSessions = sessions.filter(s => s.status === 'active');
  const totalSessions = sessions.length;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card/50 border-b border-card-border">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-xl">🌐</span>
              <span className="font-bold text-primary">ProxyHub</span>
            </Link>
            <span className="text-muted text-sm">/ Dashboard</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-muted text-sm">{user?.email}</span>
            <button
              onClick={logout}
              className="text-muted hover:text-foreground transition text-sm"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg mb-6">
            {error}
            <button onClick={() => setError('')} className="ml-4 text-white">×</button>
          </div>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="card">
            <div className="text-muted text-sm mb-2">Wallet Balance</div>
            <div className="text-3xl font-bold text-foreground">
              ₵{wallet?.balance?.toFixed(2) || '0.00'}
            </div>
          </div>
          <div className="card">
            <div className="text-muted text-sm mb-2">Active Sessions</div>
            <div className="text-3xl font-bold text-success">{activeSessions.length}</div>
          </div>
          <div className="card">
            <div className="text-muted text-sm mb-2">Total Sessions</div>
            <div className="text-3xl font-bold text-foreground">{totalSessions}</div>
          </div>
          <div className="card">
            <div className="text-muted text-sm mb-2">Trust Tier</div>
            <div className="text-2xl font-bold text-primary capitalize">
              {user?.role || 'buyer'}
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="card mb-8">
          <h2 className="text-lg font-semibold text-foreground mb-4">Quick Actions</h2>
          <div className="flex flex-wrap gap-4">
            <button
              onClick={() => handleCreateSession('rotating')}
              disabled={creatingSession}
              className="btn btn-primary shadow-retro disabled:opacity-50"
            >
              {creatingSession ? 'Creating...' : '+ New Rotating Session'}
            </button>
            <button
              onClick={() => handleCreateSession('sticky')}
              disabled={creatingSession}
              className="btn bg-[#2563eb] text-white hover:bg-blue-600 shadow-retro disabled:opacity-50"
            >
              {creatingSession ? 'Creating...' : '+ New Sticky Session'}
            </button>
            <Link
              href="/dashboard/wallet"
              className="btn bg-[#16a34a] text-white hover:bg-green-600 shadow-retro"
            >
              💳 Top Up Wallet
            </Link>
          </div>
        </div>

        {/* Sessions Table */}
        <div className="card overflow-hidden p-0">
          <div className="px-6 py-4 border-b border-card-border">
            <h2 className="text-lg font-semibold text-foreground">Your Sessions</h2>
          </div>
          {sessions.length === 0 ? (
            <div className="p-8 text-center text-muted">
              <div className="text-4xl mb-4">🔌</div>
              <p>No sessions yet. Create your first session to get started!</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-card-border/50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Type</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Credentials</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Created</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border">
                  {sessions.map((session) => (
                    <tr key={session.id} className="hover:bg-foreground/5">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${session.type === 'rotating'
                          ? 'bg-primary/10 text-primary'
                          : 'bg-info/10 text-info'
                          }`}>
                          {session.type}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${session.status === 'active'
                          ? 'bg-success/10 text-success'
                          : 'bg-muted/10 text-muted'
                          }`}>
                          {session.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap font-mono text-sm text-foreground/80">
                        {session.credentials_user}:{session.credentials_pass?.slice(0, 8)}...
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                        {new Date(session.created_at).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {session.status === 'active' && (
                          <button
                            onClick={() => handleTerminateSession(session.id)}
                            className="text-red-400 hover:text-red-300 text-sm"
                          >
                            Terminate
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
      </main>
    </div>
  );
}

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

  // Defensive check to prevent crash if sessions is not an array
  const safeSessions = Array.isArray(sessions) ? sessions : [];
  const activeSessions = safeSessions.filter(s => s.status === 'active');
  const totalSessions = sessions.length;

  return (
    <>
      <div className="space-y-6">
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg mb-6">
            {error}
            <button onClick={() => setError('')} className="ml-4 text-white">×</button>
          </div>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="card bg-gray-800/50 backdrop-blur border-gray-700/50">
            <div className="text-gray-400 text-sm mb-2">Wallet Balance</div>
            <div className="text-3xl font-bold text-white">
              ₵{wallet?.balance?.toFixed(2) || '0.00'}
            </div>
          </div>
          <div className="card bg-gray-800/50 backdrop-blur border-gray-700/50">
            <div className="text-gray-400 text-sm mb-2">Active Sessions</div>
            <div className="text-3xl font-bold text-green-400">{activeSessions.length}</div>
          </div>
          <div className="card bg-gray-800/50 backdrop-blur border-gray-700/50">
            <div className="text-gray-400 text-sm mb-2">Total Sessions</div>
            <div className="text-3xl font-bold text-white">{totalSessions}</div>
          </div>
          <div className="card bg-gray-800/50 backdrop-blur border-gray-700/50">
            <div className="text-gray-400 text-sm mb-2">Trust Tier</div>
            <div className="text-2xl font-bold text-orange-400 capitalize">
              {user?.role || 'buyer'}
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="card bg-gray-800/50 backdrop-blur border-gray-700/50">
          <h2 className="text-lg font-semibold text-white mb-4">Quick Actions</h2>
          <div className="flex flex-wrap gap-4">
            <button
              onClick={() => handleCreateSession('rotating')}
              disabled={creatingSession}
              className="btn bg-orange-500 hover:bg-orange-600 text-white shadow-lg shadow-orange-500/20 disabled:opacity-50 border-0"
            >
              {creatingSession ? 'Creating...' : '+ New Rotating Session'}
            </button>
            <button
              onClick={() => handleCreateSession('sticky')}
              disabled={creatingSession}
              className="btn bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/20 disabled:opacity-50 border-0"
            >
              {creatingSession ? 'Creating...' : '+ New Sticky Session'}
            </button>
            <Link
              href="/dashboard/wallet"
              className="btn bg-green-600 hover:bg-green-700 text-white shadow-lg shadow-green-500/20 border-0"
            >
              💳 Top Up Wallet
            </Link>
          </div>
        </div>

        {/* Sessions Table */}
        <div className="card bg-gray-800/50 backdrop-blur border-gray-700/50 overflow-hidden p-0">
          <div className="px-6 py-4 border-b border-gray-700/50">
            <h2 className="text-lg font-semibold text-white">Your Sessions</h2>
          </div>
          {sessions.length === 0 ? (
            <div className="p-12 text-center text-gray-500">
              <div className="text-4xl mb-4">🔌</div>
              <p>No sessions yet. Create your first session to get started!</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-900/50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Type</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Credentials</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Created</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/50">
                  {sessions.map((session) => (
                    <tr key={session.id} className="hover:bg-gray-700/30 transition">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${session.type === 'rotating'
                          ? 'bg-orange-500/10 text-orange-400 border border-orange-500/20'
                          : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                          }`}>
                          {session.type}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${session.status === 'active'
                          ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                          : 'bg-gray-500/10 text-gray-400 border border-gray-500/20'
                          }`}>
                          {session.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap font-mono text-sm text-gray-300">
                        {session.credentials_user}:{session.credentials_pass?.slice(0, 8)}...
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                        {new Date(session.created_at).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {session.status === 'active' && (
                          <button
                            onClick={() => handleTerminateSession(session.id)}
                            className="text-red-400 hover:text-red-300 text-sm hover:underline"
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
      </div>
    </>
  );
}

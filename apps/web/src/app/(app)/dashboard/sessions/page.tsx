'use client';

import { useEffect, useState } from 'react';
import { createSession, getSessions, terminateSession, Session } from '@/lib/api';
import { ExternalLink } from 'lucide-react';

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newCredentials, setNewCredentials] = useState<{ username: string; password: string; endpoint: string } | null>(null);

  useEffect(() => {
    fetchSessions();
  }, []);

  async function fetchSessions() {
    try {
      const data = await getSessions();
      setSessions(data);
    } catch (error) {
      console.error('Failed to fetch sessions:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateSession(type: 'rotating' | 'sticky') {
    setCreating(true);
    try {
      const result = await createSession(type);
      setNewCredentials(result.proxy_credentials);
      await fetchSessions();
    } catch (error) {
      console.error('Failed to create session:', error);
      alert('Failed to create session. Please try again.');
    } finally {
      setCreating(false);
    }
  }

  async function handleTerminate(sessionId: string) {
    if (!confirm('Are you sure you want to terminate this session?')) return;
    try {
      await terminateSession(sessionId);
      await fetchSessions();
    } catch (error) {
      console.error('Failed to terminate session:', error);
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Sessions</h1>
          <p className="text-gray-400 mt-1">Manage your proxy sessions</p>
        </div>
      </div>

      {/* Create Session */}
      <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl p-6 border border-gray-700/50">
        <h2 className="text-xl font-semibold text-white mb-4">Create New Session</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            onClick={() => handleCreateSession('rotating')}
            disabled={creating}
            className="p-6 bg-gradient-to-br from-purple-500/20 to-pink-500/20 border border-purple-500/30 rounded-xl hover:from-purple-500/30 hover:to-pink-500/30 transition disabled:opacity-50"
          >
            <h3 className="text-lg font-semibold text-white">Rotating Session</h3>
            <p className="text-gray-400 text-sm mt-2">
              IP rotates with each request. Best for scraping and data collection.
            </p>
          </button>
          <button
            onClick={() => handleCreateSession('sticky')}
            disabled={creating}
            className="p-6 bg-gradient-to-br from-blue-500/20 to-cyan-500/20 border border-blue-500/30 rounded-xl hover:from-blue-500/30 hover:to-cyan-500/30 transition disabled:opacity-50"
          >
            <h3 className="text-lg font-semibold text-white">Sticky Session</h3>
            <p className="text-gray-400 text-sm mt-2">
              Same IP for entire session. Best for account management and browsing.
            </p>
          </button>
        </div>
      </div>

      {/* New Credentials Modal */}
      {newCredentials && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-2xl p-8 max-w-md w-full mx-4 border border-gray-700">
            <h3 className="text-xl font-semibold text-white mb-4">🎉 Session Created!</h3>
            <p className="text-gray-400 mb-6">Here are your proxy credentials:</p>

            <div className="space-y-4 bg-gray-900 rounded-lg p-4">
              <div>
                <label className="text-gray-400 text-sm">Proxy Endpoint</label>
                <p className="text-white font-mono">{newCredentials.endpoint}</p>
              </div>
              <div>
                <label className="text-gray-400 text-sm">Username</label>
                <p className="text-white font-mono">{newCredentials.username}</p>
              </div>
              <div>
                <label className="text-gray-400 text-sm">Password</label>
                <p className="text-white font-mono">{newCredentials.password}</p>
              </div>
            </div>

            <div className="mt-6 p-4 bg-orange-500/10 border border-orange-500/30 rounded-lg">
              <p className="text-orange-400 text-sm">
                ⚠️ Save these credentials! They won&apos;t be shown again.
              </p>
            </div>

            <div className="mt-6 flex justify-end space-x-3">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(
                    `${newCredentials.endpoint}\n${newCredentials.username}\n${newCredentials.password}`
                  );
                }}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition"
              >
                Copy All
              </button>
              <button
                onClick={() => setNewCredentials(null)}
                className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sessions List */}
      <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl p-6 border border-gray-700/50">
        <h2 className="text-xl font-semibold text-white mb-4">Your Sessions</h2>
        {sessions.length === 0 ? (
          <p className="text-gray-400">No sessions yet. Create your first session above!</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-gray-400 text-sm border-b border-gray-700">
                  <th className="pb-3">ID</th>
                  <th className="pb-3">Type</th>
                  <th className="pb-3">Status</th>
                  <th className="pb-3">Created</th>
                  <th className="pb-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.id} className="border-b border-gray-700/50">
                    <td className="py-4 text-white font-mono text-sm">
                      <div className="flex flex-col">
                        <span>{session.id.slice(0, 8)}...</span>
                        {session.tx_hash && (
                          <a
                            href={`https://bittensor.subscan.io/extrinsic/${session.tx_hash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-[10px] text-purple-400 hover:text-purple-300 transition-colors uppercase font-bold tracking-tighter mt-0.5"
                          >
                            <ExternalLink size={10} /> View on Chain
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="py-4 text-white capitalize">{session.type}</td>
                    <td className="py-4">
                      <span
                        className={`px-2 py-1 rounded-full text-xs ${session.status === 'active'
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-gray-500/20 text-gray-400'
                          }`}
                      >
                        {session.status}
                      </span>
                    </td>
                    <td className="py-4 text-gray-400">
                      {new Date(session.created_at).toLocaleString()}
                    </td>
                    <td className="py-4 text-right">
                      {session.status === 'active' && (
                        <button
                          onClick={() => handleTerminate(session.id)}
                          className="px-3 py-1 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition text-sm"
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
  );
}

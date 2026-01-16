'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, fetchWithAuth } from '@/lib/auth';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

interface APIKey {
    id: string;
    name: string;
    key?: string; // Only present on creation
    key_prefix: string;
    permissions: string[];
    rate_limit_per_minute: number;
    expires_at?: string;
    created_at: string;
    revoked_at?: string;
}

export default function APIKeysPage() {
    const { user, isLoading, isAuthenticated } = useAuth();
    const router = useRouter();
    const [apiKeys, setApiKeys] = useState<APIKey[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newKey, setNewKey] = useState<APIKey | null>(null);

    // Form state
    const [keyName, setKeyName] = useState('');
    const [permissions, setPermissions] = useState<string[]>(['read', 'proxy']);
    const [rateLimit, setRateLimit] = useState(100);
    const [expiresInDays, setExpiresInDays] = useState<number | null>(null);

    useEffect(() => {
        if (!isLoading && !isAuthenticated) {
            router.push('/login');
            return;
        }
        if (isAuthenticated) {
            loadAPIKeys();
        }
    }, [isLoading, isAuthenticated, router]);

    const loadAPIKeys = async () => {
        setLoading(true);
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/v1/api-keys`);
            const data = await res.json();
            setApiKeys(data.api_keys || []);
        } catch (err) {
            setError('Failed to load API keys');
        } finally {
            setLoading(false);
        }
    };

    const handleCreateKey = async () => {
        if (!keyName.trim()) {
            setError('Please enter a key name');
            return;
        }

        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/v1/api-keys`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: keyName,
                    permissions,
                    rate_limit_per_minute: rateLimit,
                    expires_in_days: expiresInDays,
                }),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to create API key');
            }

            const data = await res.json();
            setNewKey(data.api_key);
            setSuccess('API key created! Copy it now - it won\'t be shown again.');
            setShowCreateModal(false);
            setKeyName('');
            setPermissions(['read', 'proxy']);
            setRateLimit(100);
            setExpiresInDays(null);
            await loadAPIKeys();
        } catch (err: any) {
            setError(err.message || 'Failed to create API key');
        }
    };

    const handleRevokeKey = async (keyId: string) => {
        if (!confirm('Are you sure you want to revoke this API key? This cannot be undone.')) {
            return;
        }

        try {
            await fetchWithAuth(`${API_BASE_URL}/v1/api-keys/${keyId}`, {
                method: 'DELETE',
            });
            setSuccess('API key revoked successfully');
            await loadAPIKeys();
        } catch (err) {
            setError('Failed to revoke API key');
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        setSuccess('Copied to clipboard!');
        setTimeout(() => setSuccess(''), 3000);
    };

    const togglePermission = (perm: string) => {
        if (permissions.includes(perm)) {
            setPermissions(permissions.filter(p => p !== perm));
        } else {
            setPermissions([...permissions, perm]);
        }
    };

    if (isLoading || loading) {
        return (
            <div className="min-h-screen bg-gray-900 flex items-center justify-center">
                <div className="text-white">Loading API Keys...</div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">API Keys</h1>
                    <p className="text-gray-400 mt-1">Manage your API keys for programmatic access</p>
                </div>
                <button
                    onClick={() => setShowCreateModal(true)}
                    className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition flex items-center gap-2"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Create API Key
                </button>
            </div>

            {/* Messages */}
            {error && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg flex justify-between">
                    <span>{error}</span>
                    <button onClick={() => setError('')} className="text-red-400 hover:text-red-300">×</button>
                </div>
            )}
            {success && (
                <div className="bg-green-500/10 border border-green-500/30 text-green-400 px-4 py-3 rounded-lg flex justify-between">
                    <span>{success}</span>
                    <button onClick={() => setSuccess('')} className="text-green-400 hover:text-green-300">×</button>
                </div>
            )}

            {/* New Key Display (only shown once after creation) */}
            {newKey?.key && (
                <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-6">
                    <div className="flex items-start gap-4">
                        <div className="p-3 bg-green-500/20 rounded-full">
                            <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                            </svg>
                        </div>
                        <div className="flex-1">
                            <h3 className="text-lg font-semibold text-white">Your New API Key</h3>
                            <p className="text-gray-400 text-sm mt-1">Copy this key now. You won't be able to see it again!</p>
                            <div className="mt-4 flex items-center gap-3">
                                <code className="flex-1 bg-gray-900 px-4 py-3 rounded font-mono text-green-400 text-sm overflow-x-auto">
                                    {newKey.key}
                                </code>
                                <button
                                    onClick={() => copyToClipboard(newKey.key!)}
                                    className="px-4 py-3 bg-green-500 text-white rounded hover:bg-green-600 transition"
                                >
                                    Copy
                                </button>
                            </div>
                        </div>
                        <button onClick={() => setNewKey(null)} className="text-gray-400 hover:text-white">×</button>
                    </div>
                </div>
            )}

            {/* API Keys List */}
            <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-700 flex justify-between items-center">
                    <h2 className="text-lg font-semibold text-white">Your API Keys</h2>
                    <span className="text-gray-400">{apiKeys.filter(k => !k.revoked_at).length} active keys</span>
                </div>

                {apiKeys.length === 0 ? (
                    <div className="p-12 text-center">
                        <div className="inline-flex p-4 bg-gray-700/30 rounded-full mb-4">
                            <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                            </svg>
                        </div>
                        <p className="text-gray-400">No API keys yet</p>
                        <p className="text-gray-500 text-sm mt-1">Create your first API key to get started</p>
                    </div>
                ) : (
                    <div className="divide-y divide-gray-700/50">
                        {apiKeys.map(key => (
                            <div key={key.id} className={`px-6 py-4 ${key.revoked_at ? 'opacity-50' : ''}`}>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className={`p-2 rounded-lg ${key.revoked_at ? 'bg-red-500/10' : 'bg-orange-500/10'}`}>
                                            <svg className={`w-5 h-5 ${key.revoked_at ? 'text-red-400' : 'text-orange-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                                            </svg>
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium text-white">{key.name}</span>
                                                {key.revoked_at && (
                                                    <span className="px-2 py-0.5 bg-red-500/20 text-red-400 rounded text-xs">Revoked</span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-3 mt-1 text-sm text-gray-400">
                                                <code className="font-mono">{key.key_prefix}...</code>
                                                <span>•</span>
                                                <span>{key.rate_limit_per_minute} req/min</span>
                                                <span>•</span>
                                                <span>Created {new Date(key.created_at).toLocaleDateString()}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <div className="flex gap-1">
                                            {key.permissions.map(perm => (
                                                <span key={perm} className="px-2 py-0.5 bg-gray-700 text-gray-300 rounded text-xs">
                                                    {perm}
                                                </span>
                                            ))}
                                        </div>
                                        {!key.revoked_at && (
                                            <button
                                                onClick={() => handleRevokeKey(key.id)}
                                                className="text-red-400 hover:text-red-300 text-sm"
                                            >
                                                Revoke
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Create Key Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
                    <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md border border-gray-700">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-xl font-semibold text-white">Create API Key</h2>
                            <button onClick={() => setShowCreateModal(false)} className="text-gray-400 hover:text-white">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Key Name</label>
                                <input
                                    type="text"
                                    value={keyName}
                                    onChange={e => setKeyName(e.target.value)}
                                    placeholder="e.g., Production Server"
                                    className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Permissions</label>
                                <div className="flex flex-wrap gap-2">
                                    {['read', 'write', 'proxy', 'admin'].map(perm => (
                                        <button
                                            key={perm}
                                            onClick={() => togglePermission(perm)}
                                            className={`px-3 py-1.5 rounded-lg text-sm transition ${permissions.includes(perm)
                                                    ? 'bg-orange-500 text-white'
                                                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                                }`}
                                        >
                                            {perm}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Rate Limit (requests/minute)</label>
                                <input
                                    type="number"
                                    value={rateLimit}
                                    onChange={e => setRateLimit(parseInt(e.target.value) || 100)}
                                    min={1}
                                    max={1000}
                                    className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-orange-500"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Expiration (optional)</label>
                                <select
                                    value={expiresInDays || ''}
                                    onChange={e => setExpiresInDays(e.target.value ? parseInt(e.target.value) : null)}
                                    className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-orange-500"
                                >
                                    <option value="">Never expires</option>
                                    <option value="30">30 days</option>
                                    <option value="90">90 days</option>
                                    <option value="180">180 days</option>
                                    <option value="365">1 year</option>
                                </select>
                            </div>
                        </div>

                        <div className="flex gap-3 mt-6">
                            <button
                                onClick={() => setShowCreateModal(false)}
                                className="flex-1 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleCreateKey}
                                className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition"
                            >
                                Create Key
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { getMyCircles, createCircle, Circle } from '@/lib/social-api';
import { Navbar } from '@/components/Navbar';

export default function ClansPage() {
    const { user, isAuthenticated, isLoading } = useAuth();
    const [circles, setCircles] = useState<Circle[]>([]);
    const [loading, setLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newClan, setNewClan] = useState({
        name: '',
        description: '',
        visibility: 'public',
        revenue_share_percent: 0.1, // Default 10%
    });

    useEffect(() => {
        if (isAuthenticated) {
            loadCircles();
        } else if (!isLoading) {
            setLoading(false);
        }
    }, [isAuthenticated, isLoading]);

    const loadCircles = async () => {
        try {
            const data = await getMyCircles();
            setCircles(data.circles || []);
        } catch {
            // ignore
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsCreating(true);
        try {
            await createCircle(newClan);
            await loadCircles();
            setShowCreateModal(false);
            setNewClan({
                name: '',
                description: '',
                visibility: 'public',
                revenue_share_percent: 0.1,
            });
        } catch (err) {
            alert('Failed to create clan');
        } finally {
            setIsCreating(false);
        }
    };

    return (
        <div className="min-h-screen" style={{ background: "var(--background)" }}>
            <Navbar />
            <main className="container py-8">
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-2xl font-bold" style={{ color: "var(--foreground)" }}>
                            My Clans
                        </h1>
                        <p style={{ color: "var(--muted)" }}>
                            Manage your circles and revenue sharing
                        </p>
                    </div>
                    {isAuthenticated && (
                        <button
                            onClick={() => setShowCreateModal(true)}
                            className="btn btn-primary"
                        >
                            + Create Clan
                        </button>
                    )}
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="spinner"></div>
                    </div>
                ) : (
                    <>
                        {circles.length === 0 ? (
                            <div className="text-center py-20 card">
                                <p style={{ color: "var(--muted)" }}>You are not a member of any clans yet.</p>
                                <button
                                    onClick={() => setShowCreateModal(true)}
                                    className="btn btn-secondary mt-4"
                                >
                                    Create one
                                </button>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {circles.map(circle => (
                                    <Link key={circle.id} href={`/dashboard/clans/${circle.id}`} className="card hover:border-primary transition-colors cursor-pointer block">
                                        <div className="flex justify-between items-start mb-2">
                                            <h3 className="font-bold text-lg" style={{ color: "var(--foreground)" }}>{circle.name}</h3>
                                            <span className="badge badge-secondary text-xs">{circle.visibility}</span>
                                        </div>
                                        <p className="text-sm line-clamp-2 mb-4" style={{ color: "var(--muted)" }}>
                                            {circle.description}
                                        </p>
                                        <div className="flex items-center justify-between text-sm" style={{ color: "var(--muted)" }}>
                                            <span>{circle.member_count} members</span>
                                            <span>{(circle.revenue_share_percent * 100).toFixed(0)}% Tax</span>
                                        </div>
                                    </Link>
                                ))}
                            </div>
                        )}
                    </>
                )}
            </main>

            {/* Create Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="card max-w-md w-full animate-in fade-in zoom-in duration-200">
                        <h2 className="text-xl font-bold mb-4" style={{ color: "var(--foreground)" }}>Create New Clan</h2>
                        <form onSubmit={handleCreate}>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium mb-1" style={{ color: "var(--foreground)" }}>Clan Name</label>
                                    <input
                                        type="text"
                                        required
                                        className="input w-full"
                                        value={newClan.name}
                                        onChange={e => setNewClan({ ...newClan, name: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1" style={{ color: "var(--foreground)" }}>Description</label>
                                    <textarea
                                        className="input w-full"
                                        value={newClan.description}
                                        onChange={e => setNewClan({ ...newClan, description: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1" style={{ color: "var(--foreground)" }}>Tax (Revenue Share %)</label>
                                    <select
                                        className="input w-full"
                                        value={newClan.revenue_share_percent}
                                        onChange={e => setNewClan({ ...newClan, revenue_share_percent: parseFloat(e.target.value) })}
                                    >
                                        <option value={0.05}>5%</option>
                                        <option value={0.10}>10%</option>
                                        <option value={0.15}>15%</option>
                                        <option value={0.20}>20%</option>
                                    </select>
                                    <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>Percentage of sales deducted for the clan wallet.</p>
                                </div>
                            </div>
                            <div className="flex gap-3 mt-6 justify-end">
                                <button
                                    type="button"
                                    onClick={() => setShowCreateModal(false)}
                                    className="btn btn-secondary"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isCreating}
                                    className="btn btn-primary"
                                >
                                    {isCreating ? 'Creating...' : 'Create Clan'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

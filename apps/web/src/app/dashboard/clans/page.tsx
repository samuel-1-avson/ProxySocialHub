"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { getMyCircles, createCircle, Circle } from '@/lib/social-api';
import { Users, Plus, Shield, Globe, Info, X, Zap, ArrowUpRight, Target, Loader2 } from 'lucide-react';

export default function ClansPage() {
    const { isAuthenticated, isLoading } = useAuth();
    const [circles, setCircles] = useState<Circle[]>([]);
    const [loading, setLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newClan, setNewClan] = useState({
        name: '',
        description: '',
        visibility: 'public', // public, private
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
            alert('Failed to architect circle');
        } finally {
            setIsCreating(false);
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-40 gap-4">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Synchronizing Protocols...</p>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-500 pb-20">
            {/* Header */}
            <div className="flex flex-col md:flex-row items-start md:items-end justify-between gap-6 border-b border-border pb-6">
                <div>
                    <div className="flex items-center gap-2 text-primary font-mono text-xs font-bold uppercase tracking-widest mb-1">
                        <Users size={14} />
                        Neural Networks
                    </div>
                    <h1 className="text-3xl font-bold font-mono uppercase tracking-tight mb-1">Circles & Clans</h1>
                    <p className="text-muted-foreground font-mono text-xs max-w-lg">
                        ESTABLISH PROPRIETARY DISTRIBUTION NETWORKS. OPTIMIZE REVENUE PROTOCOLS.
                    </p>
                </div>
                {isAuthenticated && (
                    <button
                        onClick={() => setShowCreateModal(true)}
                        className="btn-retro btn-retro-primary flex items-center gap-2"
                    >
                        <Plus size={16} />
                        INITIATE CIRCLE
                    </button>
                )}
            </div>

            {circles.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed border-border rounded-sm bg-secondary/10 text-center">
                    <div className="p-4 bg-secondary rounded-full mb-4">
                        <Users className="h-10 w-10 text-muted-foreground" />
                    </div>
                    <h3 className="font-bold font-mono uppercase text-lg text-muted-foreground">Void Detected</h3>
                    <p className="font-mono text-xs text-muted-foreground mt-2 max-w-xs mx-auto mb-6">
                        YOU ARE NOT YET A CONDUIT FOR ANY COLLECTIVE EXTRACTION NETWORKS.
                    </p>
                    <button
                        onClick={() => setShowCreateModal(true)}
                        className="btn-retro btn-retro-outline"
                    >
                        INITIATE SUBSPACE
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {circles.map(circle => (
                        <Link
                            key={circle.id}
                            href={`/dashboard/clans/${circle.id}`}
                            className="card-retro p-6 bg-card group hover:border-primary transition-all block"
                        >
                            <div className="flex justify-between items-start mb-4">
                                <div className="p-3 rounded-sm bg-primary/10 text-primary border border-primary/20 group-hover:scale-110 transition-transform">
                                    <Zap size={24} />
                                </div>
                                <div className="flex flex-col items-end gap-1">
                                    <span className="px-2 py-0.5 rounded-sm border border-border text-[10px] font-mono font-bold uppercase text-muted-foreground group-hover:text-foreground transition-colors bg-secondary">
                                        {circle.visibility}
                                    </span>
                                    <span className="text-[10px] font-mono font-bold text-primary uppercase">
                                        {((circle.revenue_share_percent || 0.1) * 100).toFixed(0)}% Tax
                                    </span>
                                </div>
                            </div>

                            <div className="space-y-2 mb-6">
                                <h3 className="text-xl font-bold font-mono uppercase truncate group-hover:text-primary transition-colors">{circle.name}</h3>
                                <p className="text-xs font-mono text-muted-foreground line-clamp-2 h-8">
                                    {circle.description}
                                </p>
                            </div>

                            <div className="pt-4 border-t border-dashed border-border flex items-center justify-between">
                                <div className="flex items-center gap-1 text-[10px] font-mono font-bold uppercase text-muted-foreground">
                                    <Users size={12} />
                                    <span className="group-hover:text-foreground transition-colors">{circle.member_count} MEMBERS</span>
                                </div>
                                <ArrowUpRight size={16} className="text-muted-foreground group-hover:text-primary transition-colors" />
                            </div>
                        </Link>
                    ))}
                </div>
            )}

            {/* Create Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
                    <div className="w-full max-w-lg bg-card border border-border rounded-sm p-8 shadow-2xl relative animate-in zoom-in-95 duration-200">
                        <div className="flex items-center justify-between mb-8 border-b border-border pb-4">
                            <h2 className="text-xl font-bold font-mono uppercase flex items-center gap-2">
                                <Target size={20} className="text-primary" />
                                Network Architecture
                            </h2>
                            <button
                                onClick={() => setShowCreateModal(false)}
                                className="text-muted-foreground hover:text-foreground transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <form onSubmit={handleCreate} className="space-y-6">
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-mono font-bold uppercase text-muted-foreground">Grid Identity</label>
                                    <input
                                        type="text"
                                        required
                                        className="w-full bg-secondary border border-border rounded-sm py-3 px-4 text-sm font-mono focus:border-primary focus:outline-none transition-all placeholder:text-muted-foreground/50 uppercase"
                                        placeholder="ENTER IDENTIFIER..."
                                        value={newClan.name}
                                        onChange={e => setNewClan({ ...newClan, name: e.target.value })}
                                    />
                                </div>

                                <div className="space-y-2">
                                    <label className="text-[10px] font-mono font-bold uppercase text-muted-foreground">Collective Objective</label>
                                    <textarea
                                        className="w-full bg-secondary border border-border rounded-sm py-3 px-4 text-sm font-mono focus:border-primary focus:outline-none transition-all min-h-[100px] resize-none placeholder:text-muted-foreground/50"
                                        placeholder="Describe emission protocols..."
                                        value={newClan.description}
                                        onChange={e => setNewClan({ ...newClan, description: e.target.value })}
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-mono font-bold uppercase text-muted-foreground">Visibility</label>
                                        <div className="relative">
                                            <select
                                                className="w-full bg-secondary border border-border rounded-sm py-3 px-4 text-xs font-mono font-bold uppercase appearance-none cursor-pointer focus:border-primary outline-none"
                                                value={newClan.visibility}
                                                onChange={e => setNewClan({ ...newClan, visibility: e.target.value })}
                                            >
                                                <option value="public">Public</option>
                                                <option value="private">Private</option>
                                            </select>
                                            <Globe size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-[10px] font-mono font-bold uppercase text-muted-foreground">Tax Protocol</label>
                                        <div className="relative">
                                            <select
                                                className="w-full bg-secondary border border-border rounded-sm py-3 px-4 text-xs font-mono font-bold uppercase appearance-none cursor-pointer focus:border-primary outline-none text-primary"
                                                value={newClan.revenue_share_percent}
                                                onChange={e => setNewClan({ ...newClan, revenue_share_percent: parseFloat(e.target.value) })}
                                            >
                                                <option value={0.05}>5% Fee</option>
                                                <option value={0.10}>10% Standard</option>
                                                <option value={0.15}>15% High</option>
                                                <option value={0.20}>20% Max</option>
                                            </select>
                                            <Shield size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-primary/50 pointer-events-none" />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="pt-4 flex gap-4">
                                <button
                                    type="button"
                                    onClick={() => setShowCreateModal(false)}
                                    className="flex-1 btn-retro btn-retro-outline"
                                >
                                    ABORT
                                </button>
                                <button
                                    type="submit"
                                    disabled={isCreating}
                                    className="flex-[2] btn-retro btn-retro-primary flex justify-center items-center gap-2"
                                >
                                    {isCreating && <Loader2 size={14} className="animate-spin" />}
                                    INITIATE GRID
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

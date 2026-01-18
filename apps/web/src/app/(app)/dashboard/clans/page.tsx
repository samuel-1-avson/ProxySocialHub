'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { getMyCircles, createCircle, Circle } from '@/lib/social-api';
import { Users, Plus, Shield, Globe, Info, X, Zap, ArrowUpRight, TrendingUp, Target } from 'lucide-react';

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
            alert('Failed to architecture circle');
        } finally {
            setIsCreating(false);
        }
    };

    return (
        <div className="max-w-7xl mx-auto space-y-12 pb-32 relative px-4 text-white">
            {/* Ambient Background Elements */}
            <div className="absolute top-0 right-[-10%] w-[500px] h-[500px] bg-primary/10 blur-[120px] rounded-full -z-10 animate-pulse"></div>
            <div className="absolute top-[20%] left-[-5%] w-[400px] h-[400px] bg-blue-500/5 blur-[100px] rounded-full -z-10"></div>

            <div className="flex flex-col md:flex-row items-start md:items-end justify-between gap-8 pt-10">
                <div className="space-y-4">
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 backdrop-blur-xl">
                        <Users size={14} className="text-primary" />
                        <span className="text-[10px] font-black uppercase tracking-[0.3em]">Neural Networks</span>
                    </div>
                    <h1 className="text-6xl font-black tracking-tighter sm:text-7xl">
                        Collective <span className="text-primary italic">Intelligence</span>
                    </h1>
                    <p className="text-muted-foreground max-w-2xl text-lg italic opacity-80 leading-relaxed">
                        Establish and manage your proprietary distribution networks. Optimize revenue sharing protocols across multi-node architectures.
                    </p>
                </div>
                {isAuthenticated && (
                    <button
                        onClick={() => setShowCreateModal(true)}
                        className="group relative flex items-center gap-4 px-10 py-5 rounded-[2rem] bg-primary text-black text-sm font-black shadow-[0_20px_40px_-10px_rgba(var(--primary-rgb),0.3)] hover:scale-[1.05] active:scale-95 transition-all duration-500 overflow-hidden"
                    >
                        <div className="absolute top-0 left-0 w-full h-full bg-[linear-gradient(45deg,rgba(255,255,255,0.2),transparent)] opacity-0 group-hover:opacity-100 transition-opacity"></div>
                        <Plus size={20} className="stroke-[3px]" />
                        <span className="uppercase tracking-widest">Architect New Circle</span>
                    </button>
                )}
            </div>

            {loading ? (
                <div className="flex flex-col items-center justify-center py-40 space-y-6">
                    <div className="w-16 h-16 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                    <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest animate-pulse italic">Synchronizing Protocols...</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 animate-in fade-in slide-in-from-bottom-10 duration-700">
                    {circles.length === 0 ? (
                        <div className="md:col-span-3 py-40 rounded-[4rem] bg-white/[0.01] border-2 border-dashed border-white/5 flex flex-col items-center justify-center space-y-8 backdrop-blur-3xl relative overflow-hidden group">
                            <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_50%_40%,rgba(var(--primary-rgb),0.03),transparent)] pointer-events-none"></div>
                            <div className="w-24 h-24 rounded-[2.5rem] bg-white/5 border border-white/10 flex items-center justify-center text-white/10 shadow-2xl group-hover:scale-110 transition-transform duration-500 group-hover:rotate-12 group-hover:text-primary/20">
                                <Users size={48} />
                            </div>
                            <div className="text-center space-y-2">
                                <h3 className="text-2xl font-black uppercase tracking-tighter italic">Void Detected</h3>
                                <p className="text-muted-foreground max-w-sm italic opacity-60">You are not yet a conduit for any collective extraction networks.</p>
                            </div>
                            <button
                                onClick={() => setShowCreateModal(true)}
                                className="px-10 py-4 rounded-2xl bg-white/5 border border-white/10 text-white text-[10px] font-black uppercase tracking-widest hover:bg-primary hover:text-black hover:border-primary transition-all duration-300 shadow-2xl"
                            >
                                Initiate Primary Sub-Network
                            </button>
                        </div>
                    ) : (
                        circles.map(circle => (
                            <Link
                                key={circle.id}
                                href={`/dashboard/clans/${circle.id}`}
                                className="group relative p-10 rounded-[3.5rem] bg-white/[0.02] border border-white/5 hover:bg-white/[0.05] hover:border-primary/30 transition-all duration-500 block overflow-hidden shadow-2xl backdrop-blur-2xl"
                            >
                                <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 blur-3xl opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                <div className="absolute top-0 right-0 p-8 opacity-[0.02] group-hover:opacity-10 group-hover:scale-150 transition-all duration-700 text-white rotate-12">
                                    <Users size={120} />
                                </div>

                                <div className="relative z-10 space-y-8">
                                    <div className="flex justify-between items-start">
                                        <div className="w-16 h-16 rounded-[1.8rem] bg-primary/10 text-primary flex items-center justify-center border border-primary/20 group-hover:scale-110 group-hover:rotate-12 transition-all duration-500">
                                            <Zap size={32} className="fill-primary/20" />
                                        </div>
                                        <div className="flex flex-col items-end gap-2">
                                            <span className="px-4 py-1.5 rounded-full bg-white/5 border border-white/10 text-[9px] font-black uppercase tracking-[0.2em] text-white/40 group-hover:text-white transition-colors">
                                                {circle.visibility}
                                            </span>
                                            <span className="text-[10px] font-black text-primary uppercase italic tracking-tighter">
                                                {((circle.revenue_share_percent || 0.1) * 100).toFixed(0)}% Tax Protocol
                                            </span>
                                        </div>
                                    </div>

                                    <div className="space-y-3">
                                        <h3 className="text-3xl font-black tracking-tighter group-hover:text-primary transition-colors italic">{circle.name}</h3>
                                        <p className="text-muted-foreground text-sm line-clamp-2 leading-relaxed italic opacity-70">
                                            {circle.description}
                                        </p>
                                    </div>

                                    <div className="pt-8 border-t border-white/5 flex items-center justify-between">
                                        <div className="flex items-center gap-4">
                                            <div className="flex -space-x-3">
                                                {Array.from({ length: Math.min(circle.member_count, 3) }).map((_, i) => (
                                                    <div key={i} className="w-9 h-9 rounded-2xl bg-[#0a0a0a] border-2 border-white/10 flex items-center justify-center text-[10px] font-black text-primary/30 group-hover:border-primary/50 transition-colors">
                                                        N
                                                    </div>
                                                ))}
                                            </div>
                                            <div className="text-[10px] flex flex-col items-start gap-1">
                                                <span className="font-black text-white group-hover:text-primary transition-colors">{circle.member_count} Members</span>
                                                <span className="text-white/20 uppercase tracking-widest font-black">Active Nodes</span>
                                            </div>
                                        </div>
                                        <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-white/20 group-hover:bg-primary group-hover:text-black transition-all duration-500">
                                            <ArrowUpRight size={20} />
                                        </div>
                                    </div>
                                </div>
                            </Link>
                        ))
                    )}
                </div>
            )}

            {/* Premium Create Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 bg-black/90 backdrop-blur-2xl flex items-center justify-center z-[200] p-4 animate-in fade-in zoom-in-95 duration-500">
                    <div className="w-full max-w-2xl bg-[#080808]/90 border border-white/10 rounded-[4rem] p-12 relative shadow-[0_50px_100px_-20px_rgba(0,0,0,0.5)] overflow-hidden">
                        <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-primary/10 blur-[100px] rounded-full translate-x-1/2 -translate-y-1/2 pointer-events-none"></div>
                        <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-blue-500/5 blur-[80px] rounded-full -translate-x-1/2 translate-y-1/2 pointer-events-none"></div>

                        <div className="relative z-10">
                            <div className="flex items-center justify-between mb-12">
                                <div className="space-y-1">
                                    <h1 className="text-3xl font-black text-white tracking-tighter uppercase italic">Network Architecture</h1>
                                    <p className="text-muted-foreground text-sm italic opacity-60">Define the core parameters of your sub-extraction grid.</p>
                                </div>
                                <button
                                    onClick={() => setShowCreateModal(false)}
                                    className="p-4 rounded-3xl bg-white/5 text-muted-foreground hover:text-white hover:bg-white/10 transition-all border border-white/5"
                                >
                                    <X size={24} />
                                </button>
                            </div>

                            <form onSubmit={handleCreate} className="space-y-8">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                    <div className="md:col-span-2 space-y-3">
                                        <label className="text-[10px] font-black uppercase tracking-[0.3em] text-white/30 ml-2 italic">Grid Identity</label>
                                        <div className="relative group">
                                            <div className="absolute left-6 top-1/2 -translate-y-1/2 text-primary/50 group-focus-within:text-primary transition-colors">
                                                <Target size={20} />
                                            </div>
                                            <input
                                                type="text"
                                                required
                                                className="w-full bg-white/5 border border-white/5 rounded-[1.8rem] py-5 pl-16 pr-8 text-md font-black text-white focus:border-primary/50 focus:bg-white/[0.08] outline-none transition-all placeholder:text-white/10 italic"
                                                placeholder="Enter alpha-numeric identifier..."
                                                value={newClan.name}
                                                onChange={e => setNewClan({ ...newClan, name: e.target.value })}
                                            />
                                        </div>
                                    </div>

                                    <div className="md:col-span-2 space-y-3">
                                        <label className="text-[10px] font-black uppercase tracking-[0.3em] text-white/30 ml-2 italic">Collective Objective</label>
                                        <textarea
                                            className="w-full bg-white/5 border border-white/5 rounded-[2rem] py-6 px-8 text-md font-medium text-white focus:border-primary/50 focus:bg-white/[0.08] outline-none transition-all min-h-[140px] resize-none placeholder:text-white/10 italic leading-relaxed"
                                            placeholder="Describe the circle's primary mission and engagement rules..."
                                            value={newClan.description}
                                            onChange={e => setNewClan({ ...newClan, description: e.target.value })}
                                        />
                                    </div>

                                    <div className="space-y-3">
                                        <label className="text-[10px] font-black uppercase tracking-[0.3em] text-white/30 ml-2 italic">Broadcast Visibility</label>
                                        <div className="relative">
                                            <select
                                                className="w-full bg-white/5 border border-white/5 rounded-[1.5rem] py-5 px-8 text-sm font-black text-white hover:bg-white/[0.08] focus:border-primary/50 outline-none transition-all appearance-none cursor-pointer uppercase tracking-widest"
                                                value={newClan.visibility}
                                                onChange={e => setNewClan({ ...newClan, visibility: e.target.value })}
                                            >
                                                <option value="public" className="bg-[#0d0d0d]">Public Discovery</option>
                                                <option value="private" className="bg-[#0d0d0d]">Encrypted / Private</option>
                                            </select>
                                            <div className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none text-white/20">
                                                <Globe size={18} />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-3">
                                        <label className="text-[10px] font-black uppercase tracking-[0.3em] text-white/30 ml-2 italic">Revenue Tax protocol</label>
                                        <div className="relative">
                                            <select
                                                className="w-full bg-white/5 border border-white/5 rounded-[1.5rem] py-5 px-8 text-sm font-black text-white hover:bg-white/[0.08] focus:border-primary/50 outline-none transition-all appearance-none cursor-pointer uppercase tracking-widest text-primary"
                                                value={newClan.revenue_share_percent}
                                                onChange={e => setNewClan({ ...newClan, revenue_share_percent: parseFloat(e.target.value) })}
                                            >
                                                <option value={0.05} className="bg-[#0d0d0d]">5% Infrastructure Fee</option>
                                                <option value={0.10} className="bg-[#0d0d0d]">10% Standard Protocol</option>
                                                <option value={0.15} className="bg-[#0d0d0d]">15% Aggressive Growth</option>
                                                <option value={0.20} className="bg-[#0d0d0d]">20% Maximum Scaling</option>
                                            </select>
                                            <div className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none text-primary/40">
                                                <Shield size={18} />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="pt-10 flex flex-col sm:flex-row items-center gap-6">
                                    <button
                                        type="button"
                                        onClick={() => setShowCreateModal(false)}
                                        className="w-full sm:flex-1 py-5 rounded-[1.8rem] bg-white/5 border border-white/5 text-white text-[10px] font-black uppercase tracking-[0.3em] hover:bg-white/10 transition-all italic hover:border-white/20"
                                    >
                                        Abort Protocol
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={isCreating}
                                        className="w-full sm:flex-[2] relative group py-5 rounded-[1.8rem] bg-primary text-black text-[10px] font-black uppercase tracking-[0.3em] shadow-[0_20px_40px_rgba(var(--primary-rgb),0.3)] hover:scale-[1.05] active:scale-95 transition-all duration-500 overflow-hidden disabled:opacity-50"
                                    >
                                        <div className="absolute top-0 left-[-100%] w-full h-full bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.4),transparent)] group-hover:left-[100%] transition-all duration-1000"></div>
                                        {isCreating ? 'Synchronizing Intelligence...' : 'Initiate Collective Grid'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

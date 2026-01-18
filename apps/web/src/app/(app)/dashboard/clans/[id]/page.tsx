'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { getCircle, Circle } from '@/lib/social-api';
import { ArrowLeft, Users, Zap, Shield, LayoutGrid, User, Info, MoreVertical, Target, Share2, Plus, Globe } from 'lucide-react';

export default function CircleDetailsPage() {
    const params = useParams();
    const { isAuthenticated } = useAuth();
    const circleId = params?.id as string;
    const [circle, setCircle] = useState<Circle | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        if (circleId) {
            loadCircle();
        }
    }, [circleId]);

    const loadCircle = async () => {
        try {
            const data = await getCircle(circleId);
            setCircle(data);
        } catch {
            setError('Circle network integrity compromised');
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-40 space-y-6">
                <div className="w-16 h-16 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest animate-pulse italic">Synchronizing Neural Path...</p>
            </div>
        );
    }

    if (error || !circle) {
        return (
            <div className="max-w-2xl mx-auto py-32 px-6">
                <div className="p-16 rounded-[3.5rem] bg-destructive/5 border border-destructive/20 text-center backdrop-blur-3xl space-y-8 animate-in zoom-in-95 duration-500">
                    <div className="w-24 h-24 rounded-[2rem] bg-destructive/10 flex items-center justify-center mx-auto text-destructive shadow-2xl">
                        <Info size={48} />
                    </div>
                    <div className="space-y-2">
                        <h2 className="text-3xl font-black text-white tracking-tighter uppercase italic">Protocol Breach</h2>
                        <p className="text-muted-foreground italic opacity-70">{error || 'Identification of the requested sub-network failed.'}</p>
                    </div>
                    <Link
                        href="/dashboard/clans"
                        className="inline-flex items-center gap-4 px-10 py-5 rounded-[1.8rem] bg-white/5 border border-white/10 text-white text-[10px] font-black uppercase tracking-widest hover:bg-white/10 transition-all hover:scale-[1.05] active:scale-95 shadow-2xl"
                    >
                        <ArrowLeft size={16} />
                        Return to Grid Core
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-6xl mx-auto space-y-12 pb-32 relative px-4 text-white">
            {/* Background Aesthetics */}
            <div className="absolute top-0 left-0 w-[600px] h-[600px] bg-primary/10 blur-[150px] rounded-full -z-10 animate-pulse"></div>
            <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-blue-500/5 blur-[120px] rounded-full -z-10"></div>

            <Link
                href="/dashboard/clans"
                className="group inline-flex items-center gap-3 text-[10px] font-black uppercase tracking-[0.3em] text-white/40 hover:text-primary transition-all duration-300"
            >
                <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-primary/20 group-hover:-translate-x-1 transition-all">
                    <ArrowLeft size={14} />
                </div>
                Network Sub-Grid Index
            </Link>

            {/* Premium Header Card */}
            <div className="relative group p-12 rounded-[4rem] bg-white/[0.03] border border-white/10 backdrop-blur-3xl overflow-hidden shadow-[0_50px_100px_-20px_rgba(0,0,0,0.5)]">
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary/10 blur-[120px] rounded-full translate-x-1/2 -translate-y-1/2 pointer-events-none group-hover:bg-primary/20 transition-colors duration-1000"></div>
                <div className="absolute top-0 right-0 p-12 opacity-[0.03] group-hover:opacity-[0.15] group-hover:scale-125 transition-all duration-1000 pointer-events-none">
                    <Zap size={240} className="fill-white" />
                </div>

                <div className="relative z-10 flex flex-col lg:flex-row justify-between items-start gap-12">
                    <div className="space-y-8 flex-1">
                        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-8">
                            <div className="w-24 h-24 rounded-[2.2rem] bg-primary/20 text-primary flex items-center justify-center border border-primary/30 shadow-[0_20px_40px_-5px_rgba(var(--primary-rgb),0.3)] group-hover:rotate-12 group-hover:scale-110 transition-all duration-700">
                                <Zap size={48} className="fill-primary/20 stroke-[2.5px]" />
                            </div>
                            <div className="space-y-2">
                                <h1 className="text-5xl font-black tracking-tighter sm:text-6xl italic group-hover:text-primary transition-colors">{circle.name}</h1>
                                <div className="flex flex-wrap items-center gap-4">
                                    <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 backdrop-blur-xl">
                                        <Shield size={14} className="text-primary" />
                                        <span className="text-[10px] font-black uppercase tracking-[0.2em]">{(circle.revenue_share_percent * 100).toFixed(0)}% Tax Protocol</span>
                                    </div>
                                    <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 backdrop-blur-xl">
                                        <Globe size={14} className="text-white/40" />
                                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40 italic">{circle.visibility} discovery</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <p className="text-xl text-muted-foreground leading-relaxed max-w-3xl italic opacity-80">
                            {circle.description}
                        </p>

                        <div className="flex flex-wrap items-center gap-12 pt-10 border-t border-white/5">
                            <div className="space-y-2">
                                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-white/20">Authorized Nodes</p>
                                <div className="text-4xl font-black tracking-tighter text-white">{circle.member_count}</div>
                            </div>
                            <div className="space-y-2">
                                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-white/20">Active Extractions</p>
                                <div className="text-4xl font-black tracking-tighter text-white/40 italic">0</div>
                            </div>
                            <div className="space-y-2">
                                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-white/20">Integrity Score</p>
                                <div className="text-4xl font-black tracking-tighter text-emerald-500 italic">99.8</div>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-col gap-4 w-full lg:w-72 pt-4">
                        <button className="relative group/btn w-full py-5 rounded-[1.8rem] bg-primary text-black text-[10px] font-black uppercase tracking-[0.2em] shadow-[0_20px_40px_-5px_rgba(var(--primary-rgb),0.3)] hover:scale-[1.03] active:scale-95 transition-all duration-300 overflow-hidden">
                            <div className="absolute top-0 left-[-100%] w-full h-full bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.4),transparent)] group-hover/btn:left-[100%] transition-all duration-1000"></div>
                            Authorize Entry
                        </button>
                        <div className="flex gap-4">
                            <button className="flex-1 py-5 rounded-[1.5rem] bg-white/5 border border-white/10 text-white/60 hover:text-white hover:bg-white/10 transition-all flex items-center justify-center hover:scale-105 active:scale-95">
                                <Share2 size={20} />
                            </button>
                            <button className="flex-1 py-5 rounded-[1.5rem] bg-white/5 border border-white/10 text-white/60 hover:text-white hover:bg-white/10 transition-all flex items-center justify-center hover:scale-105 active:scale-95">
                                <MoreVertical size={20} />
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-12 items-start">
                {/* Proofs & Extractions */}
                <div className="lg:col-span-2 space-y-10">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className="p-3 rounded-2xl bg-white/5 border border-white/10">
                                <LayoutGrid size={24} className="text-primary" />
                            </div>
                            <h2 className="text-3xl font-black tracking-tighter uppercase italic">Network Proofs</h2>
                        </div>
                        <button className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-primary hover:underline">
                            <Plus size={14} /> Link New Node
                        </button>
                    </div>

                    <div className="p-32 rounded-[4rem] bg-white/[0.01] border-2 border-dashed border-white/5 flex flex-col items-center justify-center space-y-8 backdrop-blur-3xl relative overflow-hidden group">
                        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_50%_50%,rgba(var(--primary-rgb),0.02),transparent)] pointer-events-none"></div>
                        <div className="w-20 h-20 rounded-[2rem] bg-white/5 border border-white/10 flex items-center justify-center text-white/5 group-hover:text-primary/10 transition-all duration-700 group-hover:scale-110 group-hover:rotate-6">
                            <Target size={40} />
                        </div>
                        <div className="text-center space-y-2">
                            <p className="text-lg font-black text-white/40 italic">Zero Distribution Indicators Detected</p>
                            <p className="text-xs text-muted-foreground max-w-sm italic opacity-50 mx-auto">This sub-network has not yet linked any verified extraction proofs to the primary grid.</p>
                        </div>
                    </div>
                </div>

                {/* Sub-Network Hierarchy Sidebar */}
                <div className="space-y-10">
                    <div className="flex items-center gap-4">
                        <div className="p-3 rounded-2xl bg-white/5 border border-white/10">
                            <Users size={24} className="text-primary" />
                        </div>
                        <h2 className="text-3xl font-black tracking-tighter uppercase italic">Hierarchy</h2>
                    </div>

                    <div className="space-y-4">
                        {/* Leader/Owner */}
                        <div className="group relative flex items-center gap-5 p-6 rounded-[2.5rem] bg-white/[0.03] border border-white/5 backdrop-blur-xl hover:bg-white/[0.06] hover:border-primary/20 transition-all duration-300 cursor-pointer overflow-hidden shadow-2xl">
                            <div className="absolute top-0 right-0 w-16 h-16 bg-primary/5 blur-2xl opacity-0 group-hover:opacity-100 transition-opacity"></div>
                            <div className="w-16 h-16 rounded-[1.3rem] bg-primary/20 text-primary flex items-center justify-center border border-primary/20 shadow-inner group-hover:scale-110 transition-transform duration-500">
                                <span className="text-xl font-black">LE</span>
                            </div>
                            <div className="flex-1">
                                <p className="text-md font-black text-white group-hover:text-primary transition-colors italic">Network Architect</p>
                                <p className="text-[10px] font-black text-white/40 uppercase tracking-widest mt-1">Circle Leader [Admin]</p>
                            </div>
                            <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-primary/40 group-hover:bg-primary group-hover:text-black transition-all">
                                <Zap size={14} className="fill-current" />
                            </div>
                        </div>

                        {/* Dummy list items */}
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="flex items-center gap-5 p-6 rounded-[2.5rem] bg-white/[0.01] border border-white/5 hover:bg-white/[0.03] transition-all group cursor-pointer opacity-60 hover:opacity-100">
                                <div className="w-14 h-14 rounded-[1.2rem] bg-white/5 border border-white/10 flex items-center justify-center text-white/20 font-black text-sm group-hover:border-white/30 transition-colors">
                                    N{i}
                                </div>
                                <div className="flex-1">
                                    <p className="text-sm font-black text-white italic group-hover:translate-x-1 transition-transform">Node_Contributor_{i}</p>
                                    <p className="text-[9px] font-black text-white/20 uppercase tracking-[0.2em] mt-0.5">Active Member</p>
                                </div>
                                <div className="text-[10px] font-black text-emerald-500/50 italic">ONLINE</div>
                            </div>
                        ))}

                        <button className="w-full py-5 rounded-[2rem] bg-white/[0.02] border border-dashed border-white/10 text-white/30 text-[10px] font-black uppercase tracking-widest hover:bg-white/5 hover:text-white transition-all italic">
                            View All Network Assets
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}


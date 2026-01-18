"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Star, TrendingUp, Trophy, Award, Crown, Medal, ArrowRight, Zap, Target, Shield } from "lucide-react";
import { discoverProviders, User } from "@/lib/social-api";

export default function LeaderboardsPage() {
    const [selectedTab, setSelectedTab] = useState<"sellers" | "buyers">("sellers");
    const [sortBy, setSortBy] = useState<"bandwidth" | "rating" | "orders">("bandwidth");
    const [providers, setProviders] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchProviders() {
            setLoading(true);
            try {
                const data = await discoverProviders();
                setProviders(data.providers || []);
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        }
        fetchProviders();
    }, []);

    const sortedProviders = [...providers].sort((a, b) => {
        switch (sortBy) {
            case "rating": return (b.avg_rating || 0) - (a.avg_rating || 0);
            default: return (b.total_bandwidth_sold || 0) - (a.total_bandwidth_sold || 0);
        }
    });

    return (
        <div className="max-w-6xl mx-auto space-y-12 pb-20 relative px-4">
            {/* Decorative Background */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[500px] pointer-events-none -z-10 overflow-hidden">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 blur-[120px] rounded-full animate-pulse"></div>
                <div className="absolute top-[20%] right-[-5%] w-[30%] h-[30%] bg-blue-500/10 blur-[100px] rounded-full"></div>
            </div>

            {/* Page Header */}
            <div className="text-center space-y-4 pt-10">
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/5 border border-white/10 backdrop-blur-xl mb-4">
                    <Zap size={14} className="text-primary animate-pulse" />
                    <span className="text-[10px] font-black uppercase tracking-[0.3em] text-white">Global Grid Dominance</span>
                </div>
                <h1 className="text-6xl font-black text-white tracking-tighter sm:text-7xl">
                    Hall of <span className="text-primary italic">Power</span>
                </h1>
                <p className="text-muted-foreground max-w-2xl mx-auto text-lg leading-relaxed italic">
                    Recognizing the elite network contributors and high-volume traders architecting the future of decentralized bandwidth.
                </p>
            </div>

            {/* Navigation & Controls */}
            <div className="flex flex-col md:flex-row items-center justify-center gap-6 pt-4">
                <div className="flex p-1.5 bg-white/[0.03] rounded-[2rem] border border-white/10 backdrop-blur-2xl shadow-2xl">
                    {[
                        { id: 'sellers', label: 'Top Extraction', icon: <Crown size={16} /> },
                        { id: 'buyers', label: 'Top Consumption', icon: <Target size={16} /> },
                    ].map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setSelectedTab(tab.id as any)}
                            className={`flex items-center gap-3 px-10 py-3.5 rounded-[1.5rem] text-sm font-black transition-all duration-500 uppercase tracking-widest ${selectedTab === tab.id
                                ? "bg-primary text-black shadow-[0_15px_30px_rgba(var(--primary-rgb),0.3)] scale-[1.05]"
                                : "text-white/40 hover:text-white hover:bg-white/5"
                                }`}
                        >
                            {tab.icon}
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {loading ? (
                <div className="flex flex-col items-center justify-center py-32 space-y-6">
                    <div className="w-16 h-16 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                    <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest animate-pulse">Calculating Hierarchy...</p>
                </div>
            ) : selectedTab === "sellers" ? (
                <div className="animate-in fade-in slide-in-from-bottom-10 duration-700">
                    {/* Sort Options */}
                    <div className="flex items-center justify-center gap-4 mb-16">
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30 italic">Metric Protocol:</span>
                        <div className="flex p-1 bg-white/[0.03] rounded-2xl border border-white/5">
                            {(["bandwidth", "rating"] as const).map((option) => (
                                <button
                                    key={option}
                                    onClick={() => setSortBy(option)}
                                    className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${sortBy === option
                                        ? "bg-white/10 text-white shadow-xl"
                                        : "text-muted-foreground hover:text-white"
                                        }`}
                                >
                                    {option === "bandwidth" ? "Extraction Vol" : "Trust Rating"}
                                </button>
                            ))}
                        </div>
                    </div>

                    {sortedProviders.length === 0 ? (
                        <div className="p-32 rounded-[3rem] bg-white/[0.02] border border-white/5 border-dashed text-center backdrop-blur-xl">
                            <Shield size={64} className="mx-auto text-white/10 mb-8" />
                            <p className="text-xl font-black text-white/50 uppercase tracking-tighter italic">No active nodes detected in this epoch.</p>
                        </div>
                    ) : (
                        <>
                            {/* Top 3 Podium */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-20 items-end px-4">
                                {[1, 0, 2].map((podiumIndex) => {
                                    const provider = sortedProviders[podiumIndex];
                                    if (!provider) return null;
                                    const position = podiumIndex === 0 ? 2 : podiumIndex === 1 ? 1 : 3;
                                    const styles = {
                                        1: {
                                            card: "from-yellow-500/20 to-yellow-600/5 border-yellow-500/40 shadow-[0_30px_60px_-15px_rgba(234,179,8,0.2)]",
                                            medal: "bg-yellow-500 text-black",
                                            ring: "ring-yellow-500/30",
                                            height: "md:h-[450px]"
                                        },
                                        2: {
                                            card: "from-slate-400/20 to-slate-500/5 border-slate-400/40 shadow-[0_25px_50px_-12px_rgba(148,163,184,0.15)]",
                                            medal: "bg-slate-400 text-black",
                                            ring: "ring-slate-400/30",
                                            height: "md:h-[380px]"
                                        },
                                        3: {
                                            card: "from-orange-700/20 to-orange-800/5 border-orange-700/40 shadow-[0_20px_40px_-10px_rgba(194,65,12,0.15)]",
                                            medal: "bg-orange-700 text-white",
                                            ring: "ring-orange-700/30",
                                            height: "md:h-[340px]"
                                        }
                                    }[position as 1 | 2 | 3];

                                    return (
                                        <Link
                                            key={provider.id}
                                            href={`/profile/${provider.username || provider.id}`}
                                            className={`relative group p-10 rounded-[3rem] bg-gradient-to-b ${styles.card} border backdrop-blur-2xl transition-all hover:scale-[1.03] active:scale-95 flex flex-col items-center justify-center text-center ${styles.height}`}
                                        >
                                            <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.05),transparent)] pointer-events-none"></div>

                                            {/* Medal */}
                                            <div className={`absolute -top-5 left-1/2 -translate-x-1/2 w-14 h-14 rounded-[1.2rem] ${styles.medal} flex items-center justify-center text-xl font-black shadow-[0_10px_20px_rgba(0,0,0,0.3)] rotate-[15deg] group-hover:rotate-0 transition-all duration-500`}>
                                                {position === 1 ? <Trophy size={28} /> : position}
                                            </div>

                                            <div className={`w-28 h-28 rounded-[2.5rem] bg-white/5 border border-white/10 p-1.5 ring-4 ${styles.ring} overflow-hidden mb-6 group-hover:scale-110 transition-transform duration-500`}>
                                                {provider.avatar_url ? (
                                                    <img src={provider.avatar_url} className="w-full h-full object-cover rounded-[2.2rem]" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center bg-white/5 rounded-[2.2rem] text-3xl font-black text-white/20">
                                                        {(provider.display_name?.[0] || provider.username?.[0] || "?").toUpperCase()}
                                                    </div>
                                                )}
                                            </div>

                                            <div className="space-y-1">
                                                <h3 className="text-2xl font-black text-white tracking-tighter group-hover:text-primary transition-colors">
                                                    {provider.display_name || provider.username}
                                                </h3>
                                                <p className="text-xs uppercase font-black tracking-[0.2em] text-white/40 italic">@{provider.username}</p>
                                            </div>

                                            <div className="mt-8 pt-8 border-t border-white/5 w-full flex flex-col items-center gap-2">
                                                <div className="text-3xl font-black text-white tracking-tighter">
                                                    {provider.total_bandwidth_sold?.toLocaleString() || 0}
                                                    <span className="text-[10px] text-primary uppercase ml-1 italic tracking-widest">PX-Volume</span>
                                                </div>
                                                <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/5 border border-white/10">
                                                    <Star className="w-3.5 h-3.5 text-yellow-500 fill-current" />
                                                    <span className="text-xs font-black text-white">{provider.avg_rating?.toFixed(1) || "5.0"} <span className="text-white/30 ml-1">TR</span></span>
                                                </div>
                                            </div>
                                        </Link>
                                    );
                                })}
                            </div>

                            {/* List View for Ranked Entries */}
                            <div className="bg-white/[0.02] rounded-[3rem] border border-white/5 overflow-hidden backdrop-blur-xl shadow-2xl">
                                <div className="p-8 border-b border-white/5 bg-white/[0.01] flex items-center justify-between">
                                    <h3 className="text-xs font-black text-white/40 uppercase tracking-[0.3em]">Network Hierarchy [4-50]</h3>
                                    <div className="flex items-center gap-2 text-[10px] font-black text-primary italic">
                                        <ArrowRight size={12} /> Live Updates
                                    </div>
                                </div>
                                <div className="divide-y divide-white/5">
                                    {sortedProviders.slice(3).map((provider, idx) => (
                                        <Link
                                            key={provider.id}
                                            href={`/profile/${provider.username || provider.id}`}
                                            className="flex items-center gap-6 p-6 hover:bg-white/[0.03] transition-all group relative overflow-hidden"
                                        >
                                            <div className="absolute left-0 top-0 w-1 h-full bg-primary opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                            <div className="w-12 text-center text-lg font-black text-white/20 group-hover:text-primary group-hover:scale-125 transition-all italic">
                                                #{idx + 4}
                                            </div>
                                            <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 p-1 group-hover:border-primary/50 transition-colors">
                                                {provider.avatar_url ? (
                                                    <img src={provider.avatar_url} className="w-full h-full rounded-xl object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-sm font-black text-white/20">
                                                        {(provider.display_name?.[0] || provider.username?.[0] || "?").toUpperCase()}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-lg font-black text-white group-hover:translate-x-1 transition-transform">
                                                        {provider.display_name || provider.username}
                                                    </span>
                                                    {provider.verified && <Shield size={14} className="text-primary fill-primary/20" />}
                                                </div>
                                                <span className="text-[10px] uppercase font-black tracking-widest text-white/30 italic">@{provider.username}</span>
                                            </div>
                                            <div className="text-right flex flex-col items-end gap-1">
                                                <div className="text-xl font-black text-white tracking-tighter">
                                                    {provider.total_bandwidth_sold?.toLocaleString() || 0} <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-black">GB</span>
                                                </div>
                                                <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/5 text-[10px] font-black text-yellow-500 italic">
                                                    <Star size={10} className="fill-current" />
                                                    {provider.avg_rating?.toFixed(1) || "5.0"}
                                                </div>
                                            </div>
                                        </Link>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            ) : (
                <div className="animate-in fade-in slide-in-from-bottom-10 duration-700">
                    <div className="p-32 rounded-[3.5rem] bg-[#0a0a0a]/80 border border-white/5 border-dashed text-center backdrop-blur-2xl relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_50%_50%,rgba(34,197,94,0.05),transparent)] pointer-events-none"></div>
                        <div className="w-24 h-24 rounded-[2rem] bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-10 shadow-2xl rotate-3">
                            <TrendingUp className="w-12 h-12 text-primary" />
                        </div>
                        <h3 className="text-3xl font-black text-white mb-4 tracking-tighter uppercase italic">Buyer Velocity Initializing</h3>
                        <p className="text-muted-foreground max-w-sm mx-auto text-lg leading-relaxed italic opacity-80">
                            Our neural networks are currently processing real-time exchange data. Consumer dominance metrics will be available in the next cycle.
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}

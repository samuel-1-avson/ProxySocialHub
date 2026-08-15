"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { getProposals, type Proposal } from "@/lib/services/governance";
import { GovernanceExecutionBanner } from "@/components/governance/GovernanceExecutionBanner";
import { Vote, Hammer, Plus, Clock, CheckCircle, XCircle, FileText, Loader2, ArrowRight, Hexagon, ChevronRight, Shield, Award, Activity } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { GlassCard } from "@/components/ui/glass-card";

export default function GovernancePage() {
    const [proposals, setProposals] = useState<Proposal[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");

    useEffect(() => {
        async function loadProposals() {
            try {
                const data = await getProposals();
                setProposals(data);
                setLoadError("");
            } catch (err) {
                console.error("Failed to load proposals", err);
                setLoadError(err instanceof Error ? err.message : "Failed to load proposals");
            } finally {
                setLoading(false);
            }
        }
        loadProposals();
    }, []);

    const getStatusStyles = (status: string) => {
        switch (status) {
            case 'active': return { color: 'text-primary', bg: 'bg-primary/10', border: 'border-primary/20', shadow: 'shadow-primary/20' };
            case 'passed': return { color: 'text-emerald-500', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', shadow: 'shadow-emerald-500/20' };
            case 'rejected': return { color: 'text-rose-500', bg: 'bg-rose-500/10', border: 'border-rose-500/20', shadow: 'shadow-rose-500/20' };
            case 'executed': return { color: 'text-blue-500', bg: 'bg-blue-500/10', border: 'border-blue-500/20', shadow: 'shadow-blue-500/20' };
            default: return { color: 'text-muted-foreground', bg: 'bg-white/5', border: 'border-white/10', shadow: 'shadow-transparent' };
        }
    };

    const containerVariants = {
        hidden: { opacity: 0 },
        show: {
            opacity: 1,
            transition: { staggerChildren: 0.1 }
        }
    };

    const itemVariants = {
        hidden: { opacity: 0, y: 20 },
        show: { opacity: 1, y: 0 }
    };

    return (
        <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="space-y-12 pb-20 font-mono"
        >
            {/* V4 Terminal Header */}
            <motion.div variants={itemVariants} className="flex flex-col md:flex-row justify-between items-start md:items-end gap-8 border-b border-white/5 pb-10">
                <div className="space-y-4">
                    <div className="flex items-center gap-2 text-primary text-[10px] font-black uppercase tracking-[0.4em]">
                        <Hexagon size={12} className="animate-spin-slow" /> Decentralized Autonomous Authority
                    </div>
                    <div>
                        <h1 className="text-5xl font-black uppercase tracking-tighter leading-none bg-clip-text text-transparent bg-gradient-to-r from-primary to-emerald-400">Governance</h1>
                        <p className="text-muted-foreground/40 font-mono text-[10px] mt-3 uppercase tracking-widest flex items-center gap-3">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                            Participate in protocol upgrades and parameter adjustments.
                        </p>
                    </div>
                </div>
                <Link
                    href="/governance/create"
                    className="group relative px-8 py-4 bg-primary text-primary-foreground rounded-2xl font-black text-[11px] uppercase tracking-[0.2em] hover:shadow-[0_0_30px_rgba(16,185,129,0.3)] transition-all flex items-center gap-3 active:scale-95"
                >
                    <Plus size={16} className="group-hover:rotate-90 transition-transform duration-300" />
                    Initialize Proposal
                    <div className="absolute inset-x-0 -bottom-1 h-1 bg-white/20 blur-sm rounded-full opacity-0 group-hover:opacity-100"></div>
                </Link>
            </motion.div>

            <motion.div variants={itemVariants}>
                <GovernanceExecutionBanner />
            </motion.div>

            {/* Premium Stats Grid */}
            <motion.div variants={itemVariants} className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <GlassCard className="!p-8 group overflow-hidden relative active:scale-[0.98] transition-all">
                    <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:scale-110 transition-transform">
                        <Vote size={120} className="text-primary" />
                    </div>
                    <div className="space-y-6 relative z-10">
                        <div className="text-[10px] font-black uppercase tracking-[0.4em] text-muted-foreground/40 border-b border-white/5 pb-3">Voting Influence</div>
                        <div className="space-y-1">
                            <div className="text-2xl font-black tracking-tighter text-primary group-hover:text-emerald-400 transition-colors leading-tight">
                                1 wallet = 1 vote
                            </div>
                            <div className="text-[9px] font-black uppercase text-muted-foreground/20 flex items-center gap-2">
                                <Shield size={10} /> Fixed on-chain weight (token VP later)
                            </div>
                        </div>
                    </div>
                </GlassCard>

                <GlassCard className="!p-8 group overflow-hidden relative active:scale-[0.98] transition-all">
                    <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:scale-110 transition-transform">
                        <Activity size={120} className="text-foreground" />
                    </div>
                    <div className="space-y-6 relative z-10">
                        <div className="text-[10px] font-black uppercase tracking-[0.4em] text-muted-foreground/40 border-b border-white/5 pb-3">Active Pipeline</div>
                        <div className="space-y-1">
                            <div className="text-4xl font-black tracking-tighter">{proposals.filter(p => p.status === 'active').length} UNIT(S)</div>
                            <div className="text-[9px] font-black uppercase text-muted-foreground/20 flex items-center gap-2">
                                <Clock size={10} /> Pending Settlement
                            </div>
                        </div>
                    </div>
                </GlassCard>

                <GlassCard className="!p-8 group overflow-hidden relative active:scale-[0.98] transition-all">
                    <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:scale-110 transition-transform">
                        <Award size={120} className="text-emerald-500" />
                    </div>
                    <div className="space-y-6 relative z-10">
                        <div className="text-[10px] font-black uppercase tracking-[0.4em] text-muted-foreground/40 border-b border-white/5 pb-3">Executed Sequence</div>
                        <div className="space-y-1">
                            <div className="text-4xl font-black tracking-tighter text-emerald-500">{proposals.filter(p => p.status === 'executed').length} TOTAL</div>
                            <div className="text-[9px] font-black uppercase text-muted-foreground/20 flex items-center gap-2">
                                <CheckCircle size={10} /> Votes recorded on-chain
                            </div>
                        </div>
                    </div>
                </GlassCard>
            </motion.div>

            {/* Proposals List Section */}
            <motion.div variants={itemVariants} className="space-y-8">
                <div className="flex items-center justify-between border-b border-white/5 pb-6">
                    <h2 className="text-2xl font-black uppercase tracking-tighter flex items-center gap-4">
                        <div className="p-2 rounded-xl bg-white/2 border border-white/10 shadow-lg">
                            <FileText size={20} className="text-primary" />
                        </div>
                        Consensus Ledger
                    </h2>
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/30">
                        Displaying {proposals.length} Network Proposals
                    </div>
                </div>

                <div className="min-h-[400px]">
                    <AnimatePresence mode="wait">
                        {loading ? (
                            <motion.div
                                key="loader"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="py-40 flex flex-col items-center justify-center space-y-6"
                            >
                                <Loader2 className="animate-spin text-primary" size={40} />
                                <p className="font-mono text-[10px] uppercase font-black tracking-[0.4em] text-muted-foreground/30">Accessing Authority Vault...</p>
                            </motion.div>
                        ) : loadError ? (
                            <motion.div
                                key="error"
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="text-center py-40 glass-card border border-rose-500/20 rounded-[3rem] bg-rose-500/[0.03]"
                            >
                                <XCircle size={48} className="mx-auto text-rose-400/60 mb-6" />
                                <h3 className="font-black text-xl uppercase tracking-tighter opacity-80 mb-2">Failed to load</h3>
                                <p className="font-mono text-[10px] text-rose-300/70 uppercase tracking-widest max-w-md mx-auto">{loadError}</p>
                            </motion.div>
                        ) : proposals.length === 0 ? (
                            <motion.div
                                key="empty"
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="text-center py-40 glass-card border-dashed border-white/10 rounded-[3rem] bg-white/[0.01]"
                            >
                                <Hexagon size={64} className="mx-auto text-muted-foreground/10 mb-6 animate-spin-slow" />
                                <h3 className="font-black text-xl uppercase tracking-tighter opacity-80 mb-2">Council is Quiet</h3>
                                <p className="font-mono text-[10px] text-muted-foreground/30 uppercase tracking-widest max-w-xs mx-auto">No governance signals detected in the repository.</p>
                                <Link href="/governance/create" className="mt-10 btn-retro btn-retro-outline px-8 py-3 inline-block">Initialize First Signal</Link>
                            </motion.div>
                        ) : (
                            <motion.div
                                key="list"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="grid gap-6"
                            >
                                {proposals.map((proposal, idx) => {
                                    const styles = getStatusStyles(proposal.status);
                                    return (
                                        <Link
                                            key={proposal.id}
                                            href={`/governance/${proposal.id}`}
                                            className="group block"
                                        >
                                            <GlassCard className="!p-8 group-hover:border-primary/40 transition-all group-active:scale-[0.99] relative overflow-hidden">
                                                <div className={`absolute left-0 top-0 w-1 h-full bg-primary opacity-0 group-hover:opacity-100 transition-opacity`}></div>
                                                <div className="flex flex-col lg:flex-row justify-between lg:items-center gap-8">
                                                    <div className="flex-1 space-y-4">
                                                        <div className="flex items-center flex-wrap gap-4">
                                                            <span className={`text-[9px] font-black uppercase px-3 py-1 border rounded-lg ${styles.color} ${styles.bg} ${styles.border} ${styles.shadow} shadow-lg`}>
                                                                {proposal.status}
                                                            </span>
                                                            <span className="text-[10px] font-black font-mono text-muted-foreground/20 uppercase tracking-widest">
                                                                ID: {proposal.id.split('-')[0]}
                                                            </span>
                                                        </div>
                                                        <h3 className="text-2xl font-black uppercase tracking-tighter group-hover:text-primary transition-colors leading-none">
                                                            {proposal.title}
                                                        </h3>
                                                        <p className="text-[11px] font-black uppercase leading-relaxed text-muted-foreground/40 line-clamp-2 max-w-3xl tracking-tight italic">
                                                            {proposal.description}
                                                        </p>
                                                    </div>

                                                    <div className="flex flex-row lg:flex-col justify-between items-end gap-6 lg:min-w-[200px] border-l border-white/5 pl-8 lg:border-l lg:pl-10">
                                                        <div className="text-right space-y-1">
                                                            <div className="text-[9px] font-black uppercase text-muted-foreground/30 tracking-widest">Expiration</div>
                                                            <div className="text-[11px] font-black tracking-tight">{new Date(proposal.end_time).toLocaleDateString()}</div>
                                                        </div>
                                                        <div className="text-right space-y-1">
                                                            <div className="text-[9px] font-black uppercase text-primary/60 tracking-widest">Consensus Power</div>
                                                            <div className="text-2xl font-black tracking-tighter text-foreground group-hover:text-primary transition-colors">
                                                                {proposal.total_votes}<span className="text-[10px] opacity-20 ml-1">VP</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="absolute right-6 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 group-hover:translate-x-0 translate-x-4 transition-all duration-300">
                                                    <ChevronRight size={24} className="text-primary/20" />
                                                </div>
                                            </GlassCard>
                                        </Link>
                                    );
                                })}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </motion.div>
        </motion.div>
    );
}

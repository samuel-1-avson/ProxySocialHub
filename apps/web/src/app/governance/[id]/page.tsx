"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { getProposal, castGovernanceVote, type Proposal } from "@/lib/services/governance";
import { useWallet } from "@solana/wallet-adapter-react";
import { Loader2, ArrowLeft, CheckCircle, XCircle, MessageSquare, Box, ShieldCheck, Clock, Hexagon, Zap, Target, BarChart3, Fingerprint, Terminal, FileText } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";
import { motion, AnimatePresence } from "framer-motion";
import { GlassCard } from "@/components/ui/glass-card";
import { ProposalImpactPreview } from "@/components/governance/ProposalImpactPreview";
import { ProposalTreasuryAudit } from "@/components/governance/ProposalTreasuryAudit";

export default function ProposalDetailsPage() {
    const params = useParams();
    const router = useRouter();
    const id = params?.id as string;
    const [proposal, setProposal] = useState<Proposal | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'discussion' | 'votes' | 'execution'>('votes');
    const [voting, setVoting] = useState(false);
    const [voteChoice, setVoteChoice] = useState<'yes' | 'no' | null>(null);
    const [voteError, setVoteError] = useState("");

    const { signMessage, signTransaction, publicKey } = useWallet();

    useEffect(() => {
        if (id) {
            getProposal(id)
                .then(setProposal)
                .catch(err => console.error(err))
                .finally(() => setLoading(false));
        }
    }, [id]);

    const handleVote = async () => {
        if (!voteChoice || !proposal) return;

        if (!publicKey || !signMessage || !signTransaction) {
            alert("Connect your linked Solana wallet (with transaction signing) to vote on-chain.");
            return;
        }

        setVoting(true);
        setVoteError("");
        try {
            await castGovernanceVote(
                proposal.id,
                voteChoice,
                publicKey.toBase58(),
                signMessage,
                signTransaction
            );

            const updated = await getProposal(proposal.id);
            setProposal(updated);
        } catch (err) {
            console.error("Vote failed", err);
            setVoteError(err instanceof Error ? err.message : "Vote failed");
        } finally {
            setVoting(false);
            setVoteChoice(null);
        }
    };

    const executionPayload = (() => {
        if (!proposal?.execution_data?.trim()) return {};
        try {
            return JSON.parse(proposal.execution_data) as Record<string, unknown>;
        } catch {
            return { raw: proposal.execution_data };
        }
    })();

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

    if (loading) return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 font-mono">
            <Loader2 className="animate-spin text-primary" size={40} />
            <p className="text-[10px] font-black uppercase tracking-[0.4em] text-muted-foreground/30">Synchronizing Consensus State...</p>
        </div>
    );

    if (!proposal) return (
        <div className="text-center py-40 font-mono">
            <Hexagon size={64} className="mx-auto text-muted-foreground/10 mb-6" />
            <h1 className="text-2xl font-black uppercase tracking-tighter opacity-80">Sequence Not Found</h1>
            <button onClick={() => router.back()} className="mt-8 btn-retro btn-retro-outline px-8 py-3 uppercase text-[10px] font-black tracking-widest">Return to Command</button>
        </div>
    );

    const voteData = [
        { name: 'SUPPORT', value: proposal.votes_for, color: '#10B981' },
        { name: 'REJECT', value: proposal.votes_against, color: '#F43F5E' },
    ].filter(d => d.value > 0);

    const chartData = voteData.length > 0 ? voteData : [{ name: 'EMPTY_CONSENSUS', value: 1, color: 'rgba(255,255,255,0.05)' }];

    return (
        <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="space-y-12 animate-in fade-in duration-500 max-w-6xl mx-auto font-mono pb-20"
        >
            <motion.button
                variants={itemVariants}
                onClick={() => router.back()}
                className="group flex items-center gap-3 text-[10px] font-black tracking-[0.2em] text-muted-foreground/40 hover:text-primary transition-all uppercase"
            >
                <div className="p-2 rounded-lg bg-white/2 border border-white/5 group-hover:border-primary/40 group-hover:bg-primary/5 transition-all">
                    <ArrowLeft size={14} />
                </div>
                Return to Ledger
            </motion.button>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
                {/* Main Content Area */}
                <div className="lg:col-span-8 space-y-10">
                    <motion.div variants={itemVariants} className="space-y-4">
                        <div className="flex items-center gap-4 flex-wrap">
                            <div className={`flex items-center gap-2 px-3 py-1 rounded-lg border text-[9px] font-black uppercase tracking-widest ${proposal.status === 'active' ? 'bg-primary/10 text-primary border-primary/20 shadow-lg shadow-primary/10' :
                                proposal.status === 'passed' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20 shadow-lg shadow-emerald-500/10' :
                                    'bg-white/5 text-muted-foreground border-white/10'
                                }`}>
                                <Target size={10} className={proposal.status === 'active' ? 'animate-pulse' : ''} />
                                Status: {proposal.status}
                            </div>
                            <span className="text-[10px] font-mono text-muted-foreground/20 uppercase font-black tracking-widest">
                                Sequence Registry # {proposal.id.split('-')[0]}
                            </span>
                        </div>
                        <h1 className="text-4xl lg:text-5xl font-black uppercase tracking-tighter leading-[0.9] text-foreground hover:text-primary transition-colors duration-500">{proposal.title}</h1>
                    </motion.div>

                    {/* Mode Interface Selector */}
                    <motion.div variants={itemVariants} className="flex gap-2 p-1.5 bg-white/2 border border-white/5 rounded-2xl w-fit">
                        {[
                            { id: 'votes', label: 'Consensus', icon: BarChart3 },
                            { id: 'discussion', label: 'Intel', icon: MessageSquare },
                            { id: 'execution', label: 'Payload', icon: Box },
                        ].map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id as any)}
                                className={`flex items-center gap-3 px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === tab.id
                                    ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20"
                                    : "text-muted-foreground/40 hover:text-foreground hover:bg-white/5"
                                    }`}
                            >
                                <tab.icon size={14} />
                                {tab.label}
                            </button>
                        ))}
                    </motion.div>

                    <AnimatePresence mode="wait">
                        <motion.div
                            key={activeTab}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="min-h-[400px]"
                        >
                            {activeTab === 'votes' && (
                                <GlassCard className="!p-10 grid grid-cols-1 md:grid-cols-2 gap-12 items-center relative overflow-hidden">
                                    <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent pointer-events-none" />
                                    <div className="h-64 lg:h-80 w-full relative">
                                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                            <div className="text-center space-y-1">
                                                <div className="text-[10px] font-black text-muted-foreground/30 uppercase tracking-[0.2em]">Quorum</div>
                                                <div className="text-3xl font-black tracking-tighter">{proposal.total_votes}</div>
                                                <div className="text-[8px] font-black text-primary/40 uppercase tracking-widest">VP Total</div>
                                            </div>
                                        </div>
                                        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                                            <PieChart>
                                                <Pie
                                                    data={chartData}
                                                    innerRadius={80}
                                                    outerRadius={110}
                                                    paddingAngle={8}
                                                    dataKey="value"
                                                    stroke="none"
                                                    animationBegin={0}
                                                    animationDuration={1500}
                                                >
                                                    {chartData.map((entry, index) => (
                                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                                    ))}
                                                </Pie>
                                                <RechartsTooltip
                                                    contentStyle={{ backgroundColor: '#09090b', borderColor: 'rgba(255,255,255,0.05)', borderRadius: '12px', fontFamily: 'var(--font-mono)', fontSize: '10px', textTransform: 'uppercase', fontWeight: 900 }}
                                                    itemStyle={{ color: '#fff' }}
                                                />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    </div>
                                    <div className="space-y-6 relative z-10">
                                        <div className="space-y-4">
                                            {[
                                                { label: 'SUPPORT_UNIT', votes: proposal.votes_for, color: 'bg-emerald-500' },
                                                { label: 'REJECT_UNIT', votes: proposal.votes_against, color: 'bg-rose-500' },
                                            ].map((item, i) => (
                                                <div key={i} className="group/stat">
                                                    <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest mb-2">
                                                        <div className="flex items-center gap-3">
                                                            <div className={`w-2 h-2 rounded-full ${item.color} shadow-[0_0_10px_currentColor]`} />
                                                            <span className="text-muted-foreground/60 group-hover/stat:text-foreground transition-colors">{item.label}</span>
                                                        </div>
                                                        <span className="font-black text-foreground">{item.votes.toLocaleString()} VP</span>
                                                    </div>
                                                    <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                                                        <motion.div
                                                            initial={{ width: 0 }}
                                                            animate={{ width: `${(item.votes / (proposal.total_votes || 1)) * 100}%` }}
                                                            transition={{ duration: 1, delay: 0.5 }}
                                                            className={`h-full ${item.color}`}
                                                        />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="pt-8 border-t border-white/5 flex justify-between items-center text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/30">
                                            <span>Quorum target (VP)</span>
                                            <span className="text-primary/60">{proposal.quorum.toLocaleString()} VP</span>
                                        </div>
                                    </div>
                                </GlassCard>
                            )}

                            {activeTab === 'discussion' && (
                                <GlassCard className="!p-16 text-center space-y-8 border-white/10">
                                    <div className="w-20 h-20 rounded-full bg-white/2 border border-white/5 flex items-center justify-center mx-auto">
                                        <MessageSquare size={32} className="text-primary/40" />
                                    </div>
                                    <div className="space-y-3">
                                        <h3 className="text-xl font-black uppercase tracking-tighter">Community discussion</h3>
                                        <p className="text-[10px] font-black text-muted-foreground/40 uppercase tracking-widest leading-relaxed max-w-xs mx-auto">
                                            {proposal.thread_id
                                                ? "A forum thread was created when this proposal was submitted."
                                                : "No forum thread is linked to this proposal yet."}
                                        </p>
                                    </div>
                                    {proposal.thread_id ? (
                                        <Link
                                            href={`/community/forum/thread/${proposal.thread_id}`}
                                            className="inline-block px-8 py-3 glass-card border-white/10 text-[9px] font-black uppercase tracking-[0.2em] hover:border-primary/40 transition-all rounded-xl"
                                        >
                                            Open forum thread
                                        </Link>
                                    ) : null}
                                </GlassCard>
                            )}

                            {activeTab === 'execution' && (
                                <div className="space-y-6">
                                    <GlassCard className="!p-8 bg-black/60 relative overflow-hidden group">
                                        <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none group-hover:scale-110 transition-transform">
                                            <Terminal size={120} className="text-primary" />
                                        </div>
                                        <div className="text-[10px] font-black uppercase tracking-[0.4em] text-muted-foreground/30 mb-6 border-b border-white/5 pb-4">On-Chain Payload Bytecode</div>
                                        <pre className="text-[11px] font-mono p-6 bg-white/2 border border-white/5 rounded-2xl overflow-x-auto text-primary/80 leading-relaxed max-h-[400px]">
                                            <code>{JSON.stringify(executionPayload, null, 2)}</code>
                                        </pre>
                                    </GlassCard>
                                    <div className="flex items-start gap-4 p-6 bg-primary/5 border border-primary/10 rounded-2xl">
                                        <Zap size={20} className="text-primary shrink-0" />
                                        <p className="text-[10px] font-black uppercase tracking-widest leading-relaxed text-muted-foreground/40">
                                            Sequence is verified and executed via target authority link.
                                            Manual override is restricted by atomic protocol safety.
                                        </p>
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    </AnimatePresence>

                    {/* Description Area */}
                    <motion.div variants={itemVariants} className="space-y-8 border-t border-white/5 pt-10">
                        <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-[0.4em] text-muted-foreground/40">
                            <FileText size={14} className="text-primary" /> Strategic Rationale
                        </div>
                        <p className="text-sm lg:text-lg leading-relaxed text-foreground/70 font-black uppercase tracking-tight selection:bg-primary selection:text-primary-foreground italic">
                            {proposal.description}
                        </p>
                    </motion.div>
                </div>

                {/* Sidebar - Control Module */}
                <div className="lg:col-span-4 space-y-8">
                    <motion.div variants={itemVariants}>
                        <ProposalImpactPreview mode="proposal" proposalId={proposal.id} />
                    </motion.div>
                    <motion.div variants={itemVariants}>
                        <ProposalTreasuryAudit
                            proposalId={proposal.id}
                            showWhenEmpty={proposal.type === 'treasury'}
                        />
                    </motion.div>
                    {proposal.status === 'active' && (
                        <motion.div variants={itemVariants}>
                            <GlassCard className="!p-8 border-primary/30 bg-primary/[0.03] shadow-[0_0_50px_rgba(16,185,129,0.1)] group">
                                <h3 className="text-[11px] font-black uppercase tracking-[0.4em] mb-8 border-b border-white/10 pb-4 text-muted-foreground flex justify-between items-center group-hover:text-primary transition-colors">
                                    Cast Authority
                                    <Fingerprint size={16} className="animate-pulse" />
                                </h3>

                                <div className="space-y-4">
                                    {[
                                        { id: 'yes', label: 'Support Unit', icon: CheckCircle, color: 'hover:border-emerald-500/50 hover:bg-emerald-500/5', active: 'border-emerald-500 bg-emerald-500/10 text-emerald-500 shadow-lg shadow-emerald-500/10' },
                                        { id: 'no', label: 'Reject Unit', icon: XCircle, color: 'hover:border-rose-500/50 hover:bg-rose-500/5', active: 'border-rose-500 bg-rose-500/10 text-rose-500 shadow-lg shadow-rose-500/10' },
                                    ].map((option) => (
                                        <button
                                            key={option.id}
                                            onClick={() => setVoteChoice(option.id as any)}
                                            className={`w-full p-5 rounded-2xl border border-white/5 flex items-center justify-between text-[11px] font-black uppercase tracking-widest transition-all ${voteChoice === option.id ? option.active : `bg-black/40 ${option.color} text-muted-foreground/40`
                                                }`}
                                        >
                                            {option.label}
                                            <option.icon size={18} />
                                        </button>
                                    ))}

                                    <button
                                        onClick={handleVote}
                                        disabled={!voteChoice || voting}
                                        className="w-full mt-6 py-5 bg-primary text-primary-foreground rounded-2xl font-black text-xs uppercase tracking-[0.4em] flex items-center justify-center gap-3 hover:shadow-[0_0_40px_rgba(16,185,129,0.3)] transition-all active:scale-[0.98] disabled:opacity-20"
                                    >
                                        {voting ? <Loader2 className="animate-spin" size={20} /> : <Zap size={20} />}
                                        {voting ? "INITIALIZING SIGNATURE..." : "Confirm Sequence"}
                                    </button>
                                    {voteError && (
                                        <p className="text-[9px] text-center font-black uppercase tracking-widest text-rose-400 leading-relaxed mt-4">
                                            {voteError}
                                        </p>
                                    )}
                                    <p className="text-[9px] text-center font-black uppercase tracking-[0.3em] text-muted-foreground/20 leading-relaxed mt-4">
                                        Signs vote:{proposal.id}:yes|no, builds an on-chain tx, and mirrors after relay.
                                        Abstain is not supported on-chain.
                                    </p>
                                </div>
                            </GlassCard>
                        </motion.div>
                    )}

                    <motion.div variants={itemVariants}>
                        <GlassCard className="!p-8 space-y-8 bg-white/2 border border-white/5 relative overflow-hidden group">
                            <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none" />

                            <div className="space-y-2 relative z-10">
                                <div className="text-[9px] font-black uppercase text-muted-foreground/40 tracking-[0.4em]">Originator Node</div>
                                <div className="flex items-center gap-4 p-4 rounded-2xl bg-black/40 border border-white/5 group-hover:border-primary/20 transition-all">
                                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                                        <ShieldCheck size={20} />
                                    </div>
                                    <span className="font-black text-[10px] tracking-tighter truncate text-foreground opacity-60 group-hover:opacity-100 transition-opacity">
                                        {proposal.proposer_id}
                                    </span>
                                </div>
                            </div>

                            <div className="space-y-4 relative z-10">
                                <div className="text-[9px] font-black uppercase text-muted-foreground/40 tracking-[0.4em]">Settlement Timeline</div>
                                <div className="p-5 space-y-4 rounded-2xl bg-black/20 border border-white/5">
                                    <div className="flex justify-between items-center text-[10px] uppercase font-black tracking-widest">
                                        <span className="text-muted-foreground/40 flex items-center gap-2"><Clock size={12} /> Initialized</span>
                                        <span className="text-foreground/60">{new Date(proposal.start_time).toLocaleDateString()}</span>
                                    </div>
                                    <div className="flex justify-between items-center text-[10px] uppercase font-black tracking-widest">
                                        <span className="text-primary/40 flex items-center gap-2"><Target size={12} /> Deadline</span>
                                        <span className="text-primary">{new Date(proposal.end_time).toLocaleDateString()}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-4 relative z-10">
                                <div className="text-[9px] font-black uppercase text-muted-foreground/40 tracking-[0.4em]">Proposal Meta</div>
                                <div className="flex flex-wrap gap-2">
                                    <span className="px-3 py-1 bg-white/5 border border-white/10 rounded-lg text-[8px] font-black uppercase tracking-widest text-muted-foreground/40">{proposal.type}</span>
                                    <span className="px-3 py-1 bg-white/5 border border-white/10 rounded-lg text-[8px] font-black uppercase tracking-widest text-muted-foreground/40">ED25519_SIGNED</span>
                                </div>
                            </div>
                        </GlassCard>
                    </motion.div>
                </div>
            </div>
        </motion.div>
    );
}

"use client";

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
    ShieldCheck, 
    History, 
    Globe, 
    Filter, 
    Search, 
    Zap, 
    ArrowUpRight,
    Loader2,
    CheckCircle2,
    AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { GlassCard } from '@/components/ui/glass-card';
import { UsageProofCard } from '@/components/UsageProofCard';
import { getUsageProofs, signUsageProof, submitUsageProofOnChain, UsageProofStatus } from '@/lib/api/trustless';

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

export default function TrustlessPage() {
    const queryClient = useQueryClient();
    const [filterStatus, setFilterStatus] = useState<UsageProofStatus | 'all'>('all');
    const [searchQuery, setSearchQuery] = useState('');

    const { data: proofs = [], isLoading } = useQuery({
        queryKey: ['usage-proofs', filterStatus],
        queryFn: () => getUsageProofs({ 
            status: filterStatus === 'all' ? undefined : filterStatus 
        }),
        refetchInterval: 10000,
    });

    const signMutation = useMutation({
        mutationFn: ({ id, signature }: { id: string, signature: string }) => signUsageProof(id, signature),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['usage-proofs'] });
        }
    });

    const submitMutation = useMutation({
        mutationFn: (id: string) => submitUsageProofOnChain(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['usage-proofs'] });
        }
    });

    const handleSign = async (id: string) => {
        // In a real implementation, this would trigger a wallet sign transaction
        // For now, we'll simulate a signature for the demonstration
        const mockSignature = `sig_${Math.random().toString(36).slice(2)}`;
        signMutation.mutate({ id, signature: mockSignature });
    };

    const handleSubmit = (id: string) => {
        submitMutation.mutate(id);
    };

    const filteredProofs = proofs.filter(p => 
        p.id.toLowerCase().includes(searchQuery.toLowerCase()) || 
        p.session_id.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const stats = {
        total: proofs.length,
        pending: proofs.filter(p => p.status === 'pending').length,
        onChain: proofs.filter(p => p.status === 'on_chain').length,
        totalBytes: proofs.reduce((acc, p) => acc + p.bytes_transferred, 0)
    };

    const formatBytes = (bytes: number) => {
        const gb = bytes / (1024 * 1024 * 1024);
        return gb.toFixed(2);
    };

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-40 gap-4">
                <Loader2 className="w-10 h-10 animate-spin text-primary" />
                <p className="font-mono text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground animate-pulse">Retrieving Consensus Logs...</p>
            </div>
        );
    }

    return (
        <motion.div 
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="space-y-12 pb-20"
        >
            {/* Header Section */}
            <motion.div variants={itemVariants} className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 border-b border-white/5 pb-8">
                <div>
                    <div className="flex items-center gap-2 text-primary font-mono text-[10px] font-black uppercase tracking-[0.3em] mb-1">
                        <ShieldCheck size={12} className="animate-pulse" /> Cryptographic Integrity Layer
                    </div>
                    <h1 className="text-4xl font-black font-mono uppercase tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-primary to-blue-400">
                        Trustless Proofs
                    </h1>
                </div>
                <div className="flex gap-4">
                    <GlassCard className="px-6 py-3 flex items-center gap-4 bg-primary/5 border-primary/20">
                        <div className="text-right">
                            <p className="text-[8px] font-black font-mono uppercase opacity-40">Cumulative Proof</p>
                            <p className="text-xl font-black font-mono tracking-tighter">{formatBytes(stats.totalBytes)} GB</p>
                        </div>
                        <div className="p-2 bg-primary/20 rounded-lg text-primary">
                            <Zap size={20} />
                        </div>
                    </GlassCard>
                </div>
            </motion.div>

            {/* Stats Overview */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {[
                    { label: 'Total Logs', value: stats.total, icon: History, color: 'text-white' },
                    { label: 'Awaiting Action', value: stats.pending, icon: AlertCircle, color: 'text-amber-400' },
                    { label: 'Settled On-Chain', value: stats.onChain, icon: CheckCircle2, color: 'text-emerald-400' },
                ].map((stat, i) => (
                    <motion.div key={i} variants={itemVariants}>
                        <GlassCard className="p-6 flex items-center justify-between group hover:border-white/20 transition-all">
                            <div>
                                <p className="text-[10px] font-black font-mono uppercase opacity-30 tracking-widest mb-1">{stat.label}</p>
                                <p className={`text-3xl font-black font-mono ${stat.color}`}>{stat.value}</p>
                            </div>
                            <div className={`p-4 rounded-2xl bg-white/5 border border-white/10 ${stat.color} group-hover:scale-110 transition-transform`}>
                                <stat.icon size={24} />
                            </div>
                        </GlassCard>
                    </motion.div>
                ))}
            </div>

            {/* Filtering & Search */}
            <motion.div variants={itemVariants} className="flex flex-col lg:flex-row gap-6 justify-between items-center">
                <div className="flex bg-white/5 p-1 rounded-2xl border border-white/10 w-full lg:w-auto overflow-x-auto">
                    {['all', 'pending', 'signed', 'settling', 'on_chain'].map((s) => (
                        <button
                            key={s}
                            onClick={() => setFilterStatus(s as any)}
                            className={`px-6 py-2.5 rounded-xl text-[10px] font-black font-mono uppercase transition-all whitespace-nowrap ${
                                filterStatus === s 
                                    ? 'bg-primary text-primary-foreground shadow-lg' 
                                    : 'text-muted-foreground hover:bg-white/5'
                            }`}
                        >
                            {s.replace('_', ' ')}
                        </button>
                    ))}
                </div>
                
                <div className="relative w-full lg:w-96 group">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" size={16} />
                    <input 
                        type="text"
                        placeholder="SEARCH LOG ID OR SESSION..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 font-mono text-[10px] font-black uppercase tracking-widest outline-none focus:border-primary/40 focus:bg-white/10 transition-all"
                    />
                </div>
            </motion.div>

            {/* Proofs Grid */}
            <div className="space-y-6">
                <AnimatePresence mode="popLayout">
                    {filteredProofs.length === 0 ? (
                        <motion.div 
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="py-40 text-center"
                        >
                            <GlassCard className="inline-block p-16 border-dashed border-white/10 opacity-40">
                                <Globe size={48} className="mx-auto mb-6 text-muted-foreground animate-pulse" />
                                <h3 className="text-[11px] font-black font-mono uppercase mb-2">No Proof Segments Detected</h3>
                                <p className="text-[9px] font-mono uppercase max-w-xs mx-auto font-black leading-relaxed">
                                    Consensus logs will propagate here as soon as bandwidth segments are validated by the nodes.
                                </p>
                            </GlassCard>
                        </motion.div>
                    ) : (
                        <div className="grid grid-cols-1 gap-6">
                            {filteredProofs.map((proof) => (
                                <UsageProofCard 
                                    key={proof.id} 
                                    proof={proof} 
                                    onSign={handleSign}
                                    onSubmit={handleSubmit}
                                />
                            ))}
                        </div>
                    )}
                </AnimatePresence>
            </div>
        </motion.div>
    );
}

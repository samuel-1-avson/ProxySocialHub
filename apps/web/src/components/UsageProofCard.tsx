"use client";

import { motion, AnimatePresence } from 'framer-motion';
import { 
    ShieldCheck, 
    Clock, 
    Globe, 
    AlertTriangle, 
    FileText, 
    ExternalLink,
    ChevronRight,
    Zap,
    History,
} from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import { UsageProof } from '@/lib/api/trustless';
import { formatDistanceToNow } from 'date-fns';

interface UsageProofCardProps {
    proof: UsageProof;
    onSign?: (id: string) => void;
    onSubmit?: (id: string) => void;
    isCompact?: boolean;
}

const STATUS_CONFIG = {
    pending: {
        icon: Clock,
        color: 'text-warning',
        bg: 'bg-warning/10',
        border: 'border-warning/20',
        label: 'Awaiting Signature'
    },
    signed: {
        icon: ShieldCheck,
        color: 'text-info',
        bg: 'bg-info/10',
        border: 'border-info/20',
        label: 'Signed'
    },
    settling_confidential: {
        icon: History,
        color: 'text-info',
        bg: 'bg-info/10',
        border: 'border-info/20',
        label: 'Settling'
    },
    on_chain: {
        icon: Globe,
        color: 'text-success',
        bg: 'bg-success/10',
        border: 'border-success/20',
        label: 'On-Chain'
    },
    disputed: {
        icon: AlertTriangle,
        color: 'text-destructive',
        bg: 'bg-destructive/10',
        border: 'border-destructive/20',
        label: 'Disputed'
    }
};

export function UsageProofCard({ proof, onSign, onSubmit, isCompact = false }: UsageProofCardProps) {
    const config = STATUS_CONFIG[proof.status];
    const StatusIcon = config.icon;

    const formatBytes = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full"
        >
            <GlassCard className={`group relative overflow-hidden transition-all duration-500 hover:border-primary/40 ${isCompact ? 'p-4' : 'p-6'}`}>
                {/* Status Glow */}
                <div className={`absolute -right-8 -top-8 w-24 h-24 blur-3xl opacity-10 transition-opacity group-hover:opacity-20 ${config.bg}`} />
                
                <div className="flex flex-col gap-6 relative z-10">
                    {/* Header */}
                    <div className="flex justify-between items-start">
                        <div className="flex items-center gap-4">
                            <div className={`p-3 rounded-lg border ${config.bg} ${config.border} ${config.color} shadow-sm shadow-black/20`}>
                                <StatusIcon size={isCompact ? 18 : 24} />
                            </div>
                            <div>
                                <h3 className="font-mono text-xs font-semibold flex items-center gap-2">
                                    Proof Segment <span className="opacity-30">#{proof.id.slice(0, 8)}</span>
                                </h3>
                                <div className="flex items-center gap-2 mt-1">
                                    <span className={`text-xs font-semibold font-mono px-1.5 py-0.5 rounded ${config.bg} ${config.color} border ${config.border}`}>
                                        {config.label}
                                    </span>
                                    <span className="text-xs font-mono font-semibold opacity-20">
                                        {formatDistanceToNow(new Date(proof.created_at), { addSuffix: true })}
                                    </span>
                                </div>
                            </div>
                        </div>
                        
                        {!isCompact && (
                            <div className="flex flex-col items-end">
                                <span className="text-xs font-semibold font-mono opacity-30 tracking-tight">Consumption</span>
                                <span className="text-xl font-semibold font-mono tabular-nums tracking-tight">
                                    {formatBytes(proof.total_bytes)}
                                </span>
                            </div>
                        )}
                    </div>

                    {!isCompact && (
                        <>
                            {/* Grid Data */}
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 py-4 border-y border-border">
                                <div className="space-y-1">
                                    <p className="text-xs font-semibold font-mono opacity-30">Session</p>
                                    <p className="text-xs font-mono font-semibold truncate max-w-[120px]">{proof.session_id}</p>
                                </div>
                                <div className="space-y-1 text-right lg:text-left">
                                    <p className="text-xs font-semibold font-mono opacity-30">Provider</p>
                                    <p className="text-xs font-mono font-semibold truncate max-w-[120px]">{proof.provider_wallet}</p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-xs font-semibold font-mono opacity-30">Duration Segment</p>
                                    <p className="text-xs font-mono font-semibold">
                                        {new Date(proof.period_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - 
                                        {new Date(proof.period_end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </p>
                                </div>
                                <div className="space-y-1 text-right">
                                    <p className="text-xs font-semibold font-mono opacity-30">Network</p>
                                    <div className="flex items-center justify-end gap-1">
                                        <Globe size={10} className="text-primary/50" />
                                        <span className="text-xs font-mono font-semibold">Mainnet-v1</span>
                                    </div>
                                </div>
                            </div>

                            {/* Signatures & Actions */}
                            <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                                <div className="flex items-center gap-4">
                                    <div className="flex -space-x-3">
                                        <div className={`w-8 h-8 rounded-full border-2 border-background flex items-center justify-center bg-secondary ${proof.provider_signature ? 'text-primary' : 'text-muted-foreground opacity-30'}`} title="Provider Signature">
                                            <ShieldCheck size={14} />
                                        </div>
                                        <div className={`w-8 h-8 rounded-full border-2 border-background flex items-center justify-center bg-secondary ${proof.buyer_signature ? 'text-primary' : 'text-muted-foreground opacity-30'}`} title="Buyer Signature">
                                            <ShieldCheck size={14} />
                                        </div>
                                    </div>
                                    <span className="text-xs font-mono font-semibold opacity-20 tracking-tight">
                                        Multi-Sig Consensus: {proof.provider_signature && proof.buyer_signature ? 'Verified' : 'Incomplete'}
                                    </span>
                                </div>

                                <div className="flex items-center gap-3">
                                    <span className="text-xs font-mono text-muted-foreground">
                                        On-chain ZK verify not available
                                    </span>

                                    {proof.status === 'pending' && onSign && (
                                        <button 
                                            onClick={() => onSign(proof.id)}
                                            className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg text-xs font-semibold font-mono hover:brightness-110 transition-all flex items-center gap-2 shadow-sm"
                                        >
                                            <Zap size={14} /> Sign Proof
                                        </button>
                                    )}
                                    {proof.status === 'signed' && onSubmit && (
                                        <button 
                                            onClick={() => onSubmit(proof.id)}
                                            className="px-6 py-2.5 bg-info text-background rounded-lg text-xs font-semibold font-mono hover:brightness-110 transition-all flex items-center gap-2 shadow-sm shadow-indigo-500/20"
                                        >
                                            <Globe size={14} /> Submit On-Chain
                                        </button>
                                    )}
                                    {proof.on_chain_tx_hash && (
                                        <a 
                                            href={`https://explorer.solana.com/tx/${proof.on_chain_tx_hash}`} 
                                            target="_blank" 
                                            className="p-2.5 bg-secondary border border-border rounded-lg hover:bg-secondary transition-all text-muted-foreground hover:text-foreground"
                                        >
                                            <ExternalLink size={16} />
                                        </a>
                                    )}
                                </div>
                            </div>
                        </>
                    )}

                    {isCompact && (
                        <div className="flex justify-between items-center">
                            <span className="text-sm font-mono font-semibold tabular-nums">{formatBytes(proof.total_bytes)}</span>
                            <ChevronRight size={14} className="opacity-20" />
                        </div>
                    )}
                </div>
            </GlassCard>
        </motion.div>
    );
}

"use client";

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createSession, getSessions, terminateSession } from '@/lib/api';
import { 
    ExternalLink, 
    Terminal, 
    Globe, 
    Shield, 
    Loader2, 
    Copy, 
    Trash2, 
    Plus, 
    Clock, 
    Activity, 
    Radio, 
    AlertTriangle, 
    X, 
    Zap,
    ChevronRight,
    Lock,
    ShieldCheck
} from 'lucide-react';
import { StreamingSessionCard } from '@/components/StreamingSessionCard';
import { SessionLiveCard } from '@/components/SessionLiveCard';
import { useToast } from '@/stores';
import { motion, AnimatePresence } from 'framer-motion';
import { GlassCard } from '@/components/ui/glass-card';
import { ReviewModal } from '@/components/ReviewModal';

export default function SessionsPage() {
    const queryClient = useQueryClient();
    const toast = useToast();

    const [creating, setCreating] = useState(false);
    const [newCredentials, setNewCredentials] = useState<{ username: string; password: string; endpoint: string } | null>(null);
    const [pendingTerminateId, setPendingTerminateId] = useState<string | null>(null);
    const [terminating, setTerminating] = useState(false);
    
    // Review Modal State
    const [reviewSessionId, setReviewSessionId] = useState<string | null>(null);

    const { data: sessions = [], isLoading: loading } = useQuery({
        queryKey: ['sessions'],
        queryFn: getSessions,
        refetchInterval: 10000,
        retry: 2,
    });

    async function handleCreateSession(type: 'rotating' | 'sticky') {
        setCreating(true);
        try {
            const result = await createSession({ type });
            setNewCredentials(result.proxy_credentials);
            await queryClient.invalidateQueries({ queryKey: ['sessions'] });
        } catch (error) {
            console.error('Failed to create session:', error);
            toast.error('Session failed', 'Could not create session. Please try again.');
        } finally {
            setCreating(false);
        }
    }

    async function confirmTerminate() {
        if (!pendingTerminateId) return;
        setTerminating(true);
        try {
            await terminateSession(pendingTerminateId);
            await queryClient.invalidateQueries({ queryKey: ['sessions'] });
            toast.success('Session terminated', 'The proxy tunnel has been closed.');
            setReviewSessionId(pendingTerminateId);
        } catch (error) {
            console.error('Failed to terminate session:', error);
            toast.error('Termination failed', 'Could not close the session. Please try again.');
        } finally {
            setTerminating(false);
            setPendingTerminateId(null);
        }
    }

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

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-40 gap-4">
                <Loader2 className="w-10 h-10 animate-spin text-primary" />
                <p className="font-mono text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground animate-pulse">Scanning Active Tunnels...</p>
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
                        <Terminal size={12} className="animate-pulse" /> Signal Node Alpha
                    </div>
                    <h1 className="text-4xl font-black font-mono uppercase tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-primary to-emerald-400">
                        Active Sessions
                    </h1>
                </div>
                <div className="flex bg-white/5 p-1.5 rounded-xl border border-white/10 backdrop-blur-md">
                    <span className="px-4 py-2 text-[10px] font-mono font-black uppercase text-primary bg-primary/10 rounded-lg border border-primary/20">
                        {sessions.length} / 10 Tunnel Slots
                    </span>
                </div>
            </motion.div>

            {/* Real-time Session Monitor Section */}
            <motion.div variants={itemVariants} className="space-y-6">
                <div className="flex items-center justify-between">
                    <h2 className="text-xs font-black font-mono uppercase tracking-[0.2em] flex items-center gap-2">
                        <Radio size={16} className="text-primary animate-pulse" /> Live Pulse Monitor
                    </h2>
                </div>
                <div className="rounded-2xl overflow-hidden border border-white/5 shadow-2xl">
                    <SessionLiveCard />
                </div>
            </motion.div>

            {/* Create Session Section */}
            <motion.div variants={itemVariants} className="space-y-6">
                <h2 className="text-xs font-black font-mono uppercase tracking-[0.2em] flex items-center gap-2">
                    <Plus size={16} className="text-primary" /> Initiate New Session
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {[
                        { 
                            type: 'rotating' as const, 
                            title: 'Rotating Segment', 
                            desc: 'IP rotates with each cryptographic request. Optimized for heavy data extraction and total anonymity.', 
                            icon: Globe,
                            gradient: "from-primary/20 to-emerald-500/20"
                        },
                        { 
                            type: 'sticky' as const, 
                            title: 'Sticky Node', 
                            desc: 'Static IP assignment for persistent sessions. Optimized for account management and session stability.', 
                            icon: Shield,
                            gradient: "from-blue-500/20 to-purple-500/20"
                        }
                    ].map((btn) => (
                        <motion.button
                            key={btn.type}
                            whileHover={{ y: -5, scale: 1.01 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => handleCreateSession(btn.type)}
                            disabled={creating}
                            className={`group relative p-8 glass-card border-white/5 bg-gradient-to-br ${btn.gradient} items-start text-left overflow-hidden disabled:opacity-50 transition-all hover:border-white/20`}
                        >
                            <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:scale-110 group-hover:opacity-10 transition-all duration-500">
                                <btn.icon size={120} />
                            </div>
                            <div className="relative z-10">
                                <div className="p-3 bg-white/5 rounded-xl border border-white/10 w-fit mb-6 group-hover:bg-primary/20 group-hover:border-primary/40 transition-colors">
                                    <btn.icon size={24} className="text-primary" />
                                </div>
                                <h3 className="text-lg font-black font-mono uppercase text-foreground mb-2 tracking-tight group-hover:text-primary transition-colors">
                                    {btn.title}
                                </h3>
                                <p className="text-[10px] font-mono text-muted-foreground/70 leading-relaxed uppercase font-black">
                                    {btn.desc}
                                </p>
                                <div className="mt-8 flex items-center gap-2 text-[9px] font-mono font-black text-primary uppercase tracking-[0.2em]">
                                    {creating ? 'Synchronizing...' : 'Establish Tunnel'} <ChevronRight size={12} />
                                </div>
                            </div>
                        </motion.button>
                    ))}
                </div>
            </motion.div>

            {/* Sessions List Section */}
            <motion.div variants={itemVariants} className="space-y-6">
                <h2 className="text-xs font-black font-mono uppercase tracking-[0.2em] flex items-center gap-2">
                    <Activity size={16} className="text-primary" /> Active Segment Overlay
                </h2>
                
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                    <AnimatePresence mode="popLayout">
                        {sessions.filter(s => s.status === 'active').map((session) => (
                            <motion.div
                                key={session.id}
                                layout
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.9 }}
                            >
                                <StreamingSessionCard
                                    session={session}
                                    onTerminate={(id) => setPendingTerminateId(id)}
                                />
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>

                {sessions.length === 0 ? (
                    <GlassCard className="p-20 text-center border-dashed border-white/10 opacity-50">
                        <p className="text-[10px] font-mono font-black uppercase tracking-[0.5em] text-muted-foreground">
                            No active tunnels detected in current sector.
                        </p>
                    </GlassCard>
                ) : (
                    <div className="overflow-hidden glass-card border-white/5 bg-white/2 rounded-2xl mt-12">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left font-mono text-xs">
                                <thead className="text-[9px] font-black uppercase text-muted-foreground/30 border-b border-white/5 bg-white/5">
                                    <tr>
                                        <th className="px-8 py-5 tracking-widest">Identifier / Logic</th>
                                        <th className="px-8 py-5 tracking-widest">Protocol Type</th>
                                        <th className="px-8 py-5 tracking-widest text-center">Status</th>
                                        <th className="px-8 py-5 tracking-widest text-center">Integrity</th>
                                        <th className="px-8 py-5 tracking-widest text-right">Synchronization</th>
                                        <th className="px-8 py-5 tracking-widest text-right">Operations</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/2">
                                    {sessions.map((session) => (
                                        <motion.tr
                                            key={session.id}
                                            layout
                                            className={`hover:bg-white/5 transition-colors group ${pendingTerminateId === session.id ? 'bg-rose-500/5' : ''}`}
                                        >
                                            <td className="px-8 py-5">
                                                <div className="font-black uppercase text-[11px] group-hover:text-primary transition-colors">
                                                    {session.id.slice(0, 12)}...
                                                </div>
                                                {session.tx_hash && (
                                                    <a
                                                        href={`https://solscan.io/tx/${session.tx_hash}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="flex items-center gap-1 text-[8px] text-primary hover:underline font-black uppercase tracking-widest mt-1"
                                                    >
                                                        <ExternalLink size={10} /> On-chain Segment
                                                    </a>
                                                )}
                                            </td>
                                            <td className="px-8 py-5 font-black uppercase opacity-60">
                                                {session.type} Tunnel
                                            </td>
                                            <td className="px-8 py-5 text-center">
                                                <span className={`px-3 py-1 rounded-full text-[9px] font-black border uppercase tracking-widest inline-block ${
                                                    session.status === 'active' 
                                                        ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.1)]' 
                                                        : 'bg-white/5 text-muted-foreground border-white/10'
                                                }`}>
                                                    {session.status}
                                                </span>
                                            </td>
                                            <td className="px-8 py-5 text-center">
                                                <div className="flex justify-center">
                                                    <a 
                                                        href={`/dashboard/trustless?session=${session.id}`}
                                                        className={`p-1.5 rounded-lg border transition-all ${
                                                            session.status === 'active' 
                                                                ? 'bg-blue-500/10 border-blue-500/20 text-blue-400 hover:bg-blue-500/20' 
                                                                : 'bg-white/5 border-white/10 text-muted-foreground opacity-30 pointer-events-none'
                                                        }`}
                                                        title="View Integrity Proofs"
                                                    >
                                                        <ShieldCheck size={14} />
                                                    </a>
                                                </div>
                                            </td>
                                            <td className="px-8 py-5 text-right">
                                                <div className="text-[10px] font-black opacity-40 uppercase">{new Date(session.created_at).toLocaleDateString()}</div>
                                                <div className="text-[9px] opacity-20 uppercase font-black">{new Date(session.created_at).toLocaleTimeString()}</div>
                                            </td>
                                            <td className="px-8 py-5 text-right">
                                                {session.status === 'active' && (
                                                    pendingTerminateId === session.id ? (
                                                        <div className="flex items-center justify-end gap-2">
                                                            <button 
                                                                onClick={confirmTerminate}
                                                                className="px-3 py-1 text-[9px] font-black uppercase bg-rose-500 text-white rounded-md hover:bg-rose-600 transition-colors shadow-lg"
                                                            >
                                                                {terminating ? '...' : 'Confirm'}
                                                            </button>
                                                            <button 
                                                                onClick={() => setPendingTerminateId(null)}
                                                                className="px-3 py-1 text-[9px] font-black uppercase bg-white/5 text-muted-foreground rounded-md hover:bg-white/10 transition-colors"
                                                            >
                                                                Cancel
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            onClick={() => setPendingTerminateId(session.id)}
                                                            className="p-2 text-muted-foreground hover:text-rose-500 transition-colors"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    )
                                                )}
                                            </td>
                                        </motion.tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </motion.div>

            {/* New Credentials Modal Overlay */}
            <AnimatePresence>
                {newCredentials && (
                    <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/80 backdrop-blur-xl flex items-center justify-center z-50 p-4"
                    >
                        <motion.div 
                            initial={{ scale: 0.9, y: 20 }}
                            animate={{ scale: 1, y: 0 }}
                            exit={{ scale: 0.9, y: 20 }}
                        >
                            <GlassCard className="w-full max-w-md p-10 border-primary shadow-[0_0_50px_rgba(34,197,94,0.15)] animate-glow">
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="p-3 bg-primary/20 rounded-2xl border border-primary/40">
                                        <Zap size={24} className="text-primary" />
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-black font-mono uppercase text-primary tracking-tighter">Tunnel Established</h3>
                                        <p className="text-[9px] font-mono uppercase text-muted-foreground tracking-widest">Secure credentials generated</p>
                                    </div>
                                </div>

                                <div className="space-y-4 bg-black/40 border border-white/5 rounded-2xl p-6 font-mono text-xs my-8">
                                    <div className="space-y-1">
                                        <label className="text-muted-foreground text-[9px] font-black uppercase tracking-widest opacity-40">Endpoint</label>
                                        <p className="text-foreground break-all font-black">{newCredentials.endpoint}</p>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-muted-foreground text-[9px] font-black uppercase tracking-widest opacity-40">Username</label>
                                        <p className="text-primary break-all font-black">{newCredentials.username}</p>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-muted-foreground text-[9px] font-black uppercase tracking-widest opacity-40">Password</label>
                                        <div className="flex justify-between items-center group/pass">
                                            <p className="text-foreground break-all font-black tracking-widest">••••••••••••</p>
                                            <button 
                                                onClick={() => {
                                                    navigator.clipboard.writeText(newCredentials.password);
                                                    toast.success('Copied', 'Password copied.');
                                                }}
                                                className="text-primary hover:text-white transition-colors"
                                            >
                                                <Copy size={14} />
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex gap-4">
                                    <button
                                        onClick={() => {
                                            navigator.clipboard.writeText(
                                                `Endpoint: ${newCredentials.endpoint}\nUser: ${newCredentials.username}\nPass: ${newCredentials.password}`
                                            );
                                            toast.success('System Sync', 'Credentials coupled to clipboard.');
                                        }}
                                        className="flex-1 py-4 bg-white/5 border border-white/10 rounded-xl text-[10px] font-mono font-black uppercase tracking-widest hover:bg-white/10 transition-all flex items-center justify-center gap-2 group"
                                    >
                                        <Copy size={14} className="group-hover:text-primary transition-colors" /> COPY ALL
                                    </button>
                                    <button
                                        onClick={() => setNewCredentials(null)}
                                        className="flex-1 py-4 bg-primary text-primary-foreground rounded-xl text-[10px] font-mono font-black uppercase tracking-widest hover:opacity-90 transition-all shadow-xl shadow-primary/20"
                                    >
                                        ACKNOWLEDGED
                                    </button>
                                </div>
                            </GlassCard>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
            
            <ReviewModal 
                isOpen={!!reviewSessionId} 
                onClose={() => setReviewSessionId(null)} 
                sessionId={reviewSessionId || ""} 
            />
        </motion.div>
    );
}

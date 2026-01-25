'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { getMarketAgents, getMyAgents, rentAgent, executeAgentJob, MarketAgent, AgentInstance } from '@/lib/api';
import { Bot, Play, Pause, Activity, Cpu, Zap, ShoppingCart, ArrowRight, Hexagon, ChevronRight, Loader2, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { GlassCard } from '@/components/ui/glass-card';

export default function AgentsPage() {
    const { isAuthenticated, user } = useAuth();
    const router = useRouter();
    const [activeTab, setActiveTab] = useState<'market' | 'my-agents'>('market');
    const [marketAgents, setMarketAgents] = useState<MarketAgent[]>([]);
    const [myAgents, setMyAgents] = useState<AgentInstance[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!isAuthenticated) {
            router.push('/login');
            return;
        }
        loadData();
    }, [isAuthenticated]);

    const loadData = async () => {
        try {
            const [marketData, myData] = await Promise.all([
                getMarketAgents(),
                getMyAgents()
            ]);
            setMarketAgents(marketData);
            setMyAgents(myData);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleRent = async (agent: MarketAgent) => {
        if (!confirm(`Rent ${agent.name} for ${agent.price_per_hour} credits/hour?`)) return;
        try {
            await rentAgent(agent.id);
            alert('Agent rented successfully!');
            loadData();
            setActiveTab('my-agents');
        } catch (err) {
            alert('Failed to rent agent');
        }
    };

    const handleExecute = async (instanceId: string) => {
        try {
            const res = await executeAgentJob(instanceId, {});
            alert(`Job started: ${res.job_id}`);
        } catch (err) {
            alert('Failed to start job');
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

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-40 gap-6">
                <Loader2 className="w-10 h-10 animate-spin text-primary" />
                <p className="font-mono text-[10px] uppercase font-black tracking-[0.4em] text-muted-foreground animate-pulse">Initializing Neural Mesh...</p>
            </div>
        );
    }

    return (
        <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="space-y-10 pb-20 font-mono"
        >
            {/* Header */}
            <motion.div variants={itemVariants} className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 border-b border-white/5 pb-8">
                <div className="space-y-1">
                    <div className="flex items-center gap-2 text-primary text-[10px] font-black uppercase tracking-[0.3em]">
                        <Hexagon size={12} className="animate-spin-slow" /> Autonomous Neural Units
                    </div>
                    <h1 className="text-4xl font-black uppercase tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-primary to-emerald-400">
                        AI Agents
                    </h1>
                    <p className="text-muted-foreground text-[11px] max-w-lg opacity-60 uppercase tracking-tight">
                        DEPLOY AUTONOMOUS WORKERS FOR NETWORK OPTIMIZATION AND SOCIAL PROTOCOLS.
                    </p>
                </div>

                <div className="flex items-center gap-4 bg-white/2 p-1 rounded-2xl border border-white/5">
                    <button
                        onClick={() => setActiveTab('market')}
                        className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'market' ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20' : 'text-muted-foreground/40 hover:text-foreground'}`}
                    >
                        Marketplace
                    </button>
                    <button
                        onClick={() => setActiveTab('my-agents')}
                        className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'my-agents' ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20' : 'text-muted-foreground/40 hover:text-foreground'}`}
                    >
                        My Units ({myAgents.length})
                    </button>
                </div>
            </motion.div>

            {/* Content */}
            <AnimatePresence mode="wait">
                {activeTab === 'market' ? (
                    <motion.div
                        key="market"
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8"
                    >
                        {marketAgents.map(agent => (
                            <GlassCard key={agent.id} className="!p-8 flex flex-col h-full hover:border-primary/40 transition-all group overflow-hidden relative">
                                <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity transform group-hover:scale-125 group-hover:rotate-12 duration-700">
                                    <Bot size={120} className="text-primary" />
                                </div>

                                <div className="flex justify-between items-start mb-8 relative z-10">
                                    <div className="p-4 rounded-2xl bg-primary/10 text-primary border border-primary/20 group-hover:shadow-[0_0_20px_rgba(16,185,129,0.2)] transition-all">
                                        <Cpu size={28} />
                                    </div>
                                    <span className="px-3 py-1 rounded-lg bg-black/40 border border-white/5 text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">
                                        ACTIVE
                                    </span>
                                </div>

                                <h3 className="text-2xl font-black uppercase tracking-tighter mb-3 group-hover:text-primary transition-colors relative z-10">{agent.name}</h3>
                                <p className="text-[11px] text-muted-foreground/40 uppercase tracking-tight leading-relaxed mb-8 flex-1 relative z-10">
                                    {agent.description}
                                </p>

                                <div className="mt-auto pt-6 border-t border-dashed border-white/5 flex items-center justify-between relative z-10">
                                    <div className="space-y-1">
                                        <div className="text-[10px] font-black text-primary tracking-[0.2em]">{agent.price_per_hour} CREDITS</div>
                                        <div className="text-[8px] text-muted-foreground/20 uppercase font-black">PER HOUR CYCLE</div>
                                    </div>
                                    <motion.button
                                        whileHover={{ scale: 1.05 }}
                                        whileTap={{ scale: 0.95 }}
                                        onClick={() => handleRent(agent)}
                                        className="bg-white/5 border border-white/10 hover:border-primary/50 text-foreground px-5 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-3 transition-all hover:bg-primary/5 shadow-xl"
                                    >
                                        Deploy <ShoppingCart size={14} />
                                    </motion.button>
                                </div>
                            </GlassCard>
                        ))}
                    </motion.div>
                ) : (
                    <motion.div
                        key="my-agents"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        className="space-y-6"
                    >
                        {myAgents.length > 0 ? myAgents.map(instance => (
                            <GlassCard key={instance.id} className="!p-6 flex flex-col md:flex-row items-center justify-between hover:bg-white/5 transition-all group border-white/5">
                                <div className="flex items-center gap-6">
                                    <div className="w-16 h-16 rounded-2xl bg-black/40 border border-white/5 flex items-center justify-center text-primary group-hover:scale-110 transition-transform shadow-lg">
                                        <Bot size={32} />
                                    </div>
                                    <div className="space-y-2">
                                        <h3 className="text-xl font-black uppercase tracking-tighter text-foreground">{instance.agent?.name || 'Unit ' + instance.id.slice(0, 4)}</h3>
                                        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                                            <div className="flex items-center gap-2">
                                                <span className={`w-2 h-2 rounded-full ${instance.status === 'idle' || instance.status === 'running' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,1)]' : 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,1)]'}`} />
                                                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">{instance.status}</span>
                                            </div>
                                            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground/30">
                                                <Activity size={12} /> Init: {new Date(instance.created_at).toLocaleString()}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <motion.button
                                    whileHover={{ scale: 1.02 }}
                                    whileTap={{ scale: 0.98 }}
                                    onClick={() => handleExecute(instance.id)}
                                    className="mt-6 md:mt-0 px-8 py-4 glass-card border-white/10 hover:border-primary/50 text-[10px] font-black uppercase tracking-[0.3em] flex items-center gap-3 transition-all hover:bg-primary/5 group/btn shadow-xl"
                                >
                                    <Play size={16} className="fill-current" />
                                    Execute Sequence
                                </motion.button>
                            </GlassCard>
                        )) : (
                            <motion.div
                                initial={{ scale: 0.95, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                className="text-center py-32 border-2 border-dashed border-white/5 rounded-[3rem] bg-white/[0.01]"
                            >
                                <div className="relative inline-block mb-8">
                                    <Bot className="w-20 h-20 text-muted-foreground/10 mx-auto" />
                                    <Sparkles className="absolute -top-2 -right-2 text-primary/40 animate-pulse" size={24} />
                                </div>
                                <h3 className="text-2xl font-black uppercase tracking-tighter opacity-80 mb-4 text-foreground">No Sub-systems Detected</h3>
                                <p className="text-[10px] font-black text-muted-foreground/30 mb-10 uppercase tracking-[0.3em] max-w-sm mx-auto leading-relaxed">
                                    AUTHORIZE AND DEPLOY AUTONOMOUS NEURAL UNITS FROM THE MARKETPLACE CLUSTER TO BEGIN.
                                </p>
                                <motion.button
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    onClick={() => setActiveTab('market')}
                                    className="px-8 py-4 glass-card border-primary/20 hover:border-primary/50 text-primary text-[10px] font-black uppercase tracking-[0.4em]"
                                >
                                    Browse Cluster
                                </motion.button>
                            </motion.div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}

'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { getMarketAgents, getMyAgents, rentAgent, executeAgentJob, MarketAgent, AgentInstance } from '@/lib/api';
import { Bot, Play, Pause, Activity, Cpu, Zap, ShoppingCart, ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';

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
        if (!confirm(`Rent ${agent.name} for ${agent.price_per_run} credits/run?`)) return;
        try {
            await rentAgent(agent.id, `${agent.name} Instance`, {});
            alert('Agent rented successfully!');
            loadData();
            setActiveTab('my-agents');
        } catch (err) {
            alert('Failed to rent agent');
        }
    };

    const handleExecute = async (instanceId: string) => {
        try {
            const res = await executeAgentJob(instanceId);
            alert(`Job started: ${res.job_id}`);
        } catch (err) {
            alert('Failed to start job');
        }
    };

    if (loading) {
        return <div className="p-8 text-center font-mono text-muted-foreground">LOADING NEURAL NETWORKS...</div>;
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-500 pb-20">
            {/* Header */}
            <div className="flex flex-col md:flex-row items-start md:items-end justify-between gap-6 border-b border-border pb-6">
                <div>
                    <div className="flex items-center gap-2 text-primary font-mono text-xs font-bold uppercase tracking-widest mb-1">
                        <Bot size={14} />
                        Autonomous Units
                    </div>
                    <h1 className="text-3xl font-bold font-mono uppercase tracking-tight mb-1">AI Agents</h1>
                    <p className="text-muted-foreground font-mono text-xs max-w-lg">
                        DEPLOY AUTONOMOUS WORKERS FOR NETWORK OPTIMIZATION AND SOCIAL PROTOCOLS.
                    </p>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-6 border-b border-border">
                <button
                    onClick={() => setActiveTab('market')}
                    className={`pb-4 text-sm font-mono font-bold uppercase transition-colors border-b-2 ${activeTab === 'market' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                >
                    Marketplace
                </button>
                <button
                    onClick={() => setActiveTab('my-agents')}
                    className={`pb-4 text-sm font-mono font-bold uppercase transition-colors border-b-2 ${activeTab === 'my-agents' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                >
                    My Active Units ({myAgents.length})
                </button>
            </div>

            {/* Content */}
            {activeTab === 'market' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {marketAgents.map(agent => (
                        <div key={agent.id} className="card-retro bg-card p-6 flex flex-col h-full hover:border-primary transition-all group">
                            <div className="flex justify-between items-start mb-4">
                                <div className="p-3 rounded-sm bg-primary/10 text-primary border border-primary/20 group-hover:scale-110 transition-transform">
                                    <Cpu size={24} />
                                </div>
                                <span className="px-2 py-0.5 rounded-sm bg-secondary border border-border text-[10px] font-mono font-bold uppercase text-muted-foreground">
                                    v{agent.version}
                                </span>
                            </div>

                            <h3 className="text-xl font-bold font-mono uppercase mb-2 group-hover:text-primary transition-colors">{agent.name}</h3>
                            <p className="text-xs font-mono text-muted-foreground mb-4 flex-1">
                                {agent.description}
                            </p>

                            <div className="mt-4 pt-4 border-t border-dashed border-border flex items-center justify-between">
                                <div className="text-xs font-mono font-bold">
                                    <span className="text-primary">{agent.price_per_run} CREDITS</span>
                                    <span className="text-muted-foreground"> / RUN</span>
                                </div>
                                <button
                                    onClick={() => handleRent(agent)}
                                    className="btn-retro btn-retro-primary text-xs py-2 px-4 flex items-center gap-2"
                                >
                                    RENT UNIT <ShoppingCart size={14} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="space-y-4">
                    {myAgents.length > 0 ? myAgents.map(instance => (
                        <div key={instance.id} className="card-retro bg-card p-6 flex items-center justify-between hover:border-primary transition-all">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 rounded-sm bg-secondary border border-border flex items-center justify-center text-primary">
                                    <Bot size={24} />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold font-mono uppercase text-foreground">{instance.name}</h3>
                                    <div className="flex items-center gap-2 mt-1">
                                        <span className={`w-2 h-2 rounded-full ${instance.status === 'active' ? 'bg-green-500' : 'bg-red-500'}`} />
                                        <span className="text-[10px] font-mono font-bold uppercase text-muted-foreground">{instance.status}</span>
                                        <span className="text-[10px] font-mono text-muted-foreground ml-2">
                                            Last Run: {instance.last_run_at ? new Date(instance.last_run_at).toLocaleString() : 'NEVER'}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <button
                                onClick={() => handleExecute(instance.id)}
                                className="btn-retro btn-retro-outline flex items-center gap-2 hover:bg-primary hover:text-primary-foreground hover:border-primary"
                            >
                                <Play size={16} />
                                EXECUTE TASK
                            </button>
                        </div>
                    )) : (
                        <div className="text-center py-20 border-2 border-dashed border-border rounded-sm bg-secondary/10">
                            <Bot className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                            <h3 className="text-lg font-bold font-mono uppercase text-foreground mb-2">No Active Agents</h3>
                            <p className="text-xs font-mono text-muted-foreground mb-6">
                                DEPLOY AUTONOMOUS UNITS FROM THE MARKETPLACE TO BEGIN.
                            </p>
                            <button onClick={() => setActiveTab('market')} className="btn-retro btn-retro-primary">
                                BROWSE MARKETPLACE
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

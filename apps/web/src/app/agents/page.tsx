"use client";

import { useEffect, useState } from 'react';
import { Bot, Plus, Play, Layers, Cpu, Loader2, ArrowRight, Zap } from 'lucide-react';
import Link from 'next/link';
import { getMarketAgents, rentAgent, MarketAgent } from '@/lib/api';
// Assuming api exists, if not we might need to verify. But code was using it.

export default function AgentsPage() {
    const [agents, setAgents] = useState<MarketAgent[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [rentingId, setRentingId] = useState<string | null>(null);

    const fetchAgents = async () => {
        try {
            const data = await getMarketAgents();
            setAgents(data);
        } catch (error) {
            console.error('Failed to fetch agents:', error);
            // alert('Failed to load AI agents from marketplace.'); // Use console or toast instead of alert ideally
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchAgents();
    }, []);

    const handleRent = async (agent: MarketAgent) => {
        setRentingId(agent.id);
        try {
            await rentAgent(agent.id);
            alert(`${agent.name} has been added to your instances.`);
        } catch (error) {
            console.error('Failed to rent agent:', error);
            alert('Rental Failed. Ensure you have enough balance in your SOL/USDT wallet.');
        } finally {
            setRentingId(null);
        }
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500 pb-20">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 border-b border-border pb-6">
                <div>
                    <h1 className="text-3xl font-bold font-mono uppercase tracking-tight mb-1">AI Agent Marketplace</h1>
                    <p className="text-muted-foreground font-mono text-xs">AUTONOMOUS INTELLIGENCE AT YOUR SERVICE.</p>
                </div>
                <div className="flex gap-3">
                    <Link href="/agents/instances" className="btn-retro btn-retro-outline bg-background flex items-center gap-2">
                        <Layers size={14} className="text-primary" />
                        MY INSTANCES
                    </Link>
                    <button className="btn-retro btn-retro-primary flex items-center gap-2">
                        <Plus size={14} />
                        CREATE AGENT
                    </button>
                </div>
            </div>

            {isLoading ? (
                <div className="flex flex-col items-center justify-center py-40 gap-4">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Syncing Market Data...</p>
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {agents.map((agent) => (
                            <div key={agent.id} className="card-retro p-6 bg-card flex flex-col group hover:border-primary transition-all">
                                <div className="flex justify-between items-start mb-4">
                                    <div className="p-3 rounded-sm bg-primary/10 text-primary border border-primary/20 group-hover:scale-110 transition-transform">
                                        <Bot size={24} />
                                    </div>
                                    <span className="px-2 py-1 rounded-sm bg-secondary border border-border text-[10px] font-mono font-bold uppercase">
                                        ACTIVE
                                    </span>
                                </div>

                                <h3 className="text-lg font-bold font-mono mb-2 uppercase">{agent.name}</h3>
                                <p className="text-xs font-mono text-muted-foreground mb-4 line-clamp-2 h-8">
                                    {agent.description || "NO DESCRIPTION PROVIDED."}
                                </p>

                                <div className="flex flex-wrap gap-2 mb-6">
                                    <span className="px-2 py-0.5 rounded-sm border border-border text-[10px] font-mono font-bold text-muted-foreground uppercase">
                                        {agent.category}
                                    </span>
                                </div>

                                <div className="mt-auto pt-4 border-t border-dashed border-border flex items-center justify-between">
                                    <div className="flex flex-col">
                                        <span className="text-[10px] font-mono text-muted-foreground uppercase">Rate / Run</span>
                                        <span className="font-bold font-mono text-primary">{agent.price_per_hour} Credits / HR</span>
                                    </div>
                                    <button
                                        onClick={() => handleRent(agent)}
                                        disabled={!!rentingId}
                                        className="btn-retro btn-retro-primary py-2 px-4 text-xs flex items-center gap-2"
                                    >
                                        {rentingId === agent.id ? (
                                            <Loader2 size={14} className="animate-spin" />
                                        ) : (
                                            <>
                                                DEPLOY <Play size={10} />
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>

                    {agents.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed border-border rounded-sm bg-secondary/10">
                            <Cpu className="w-12 h-12 mx-auto text-muted-foreground opacity-30 mb-4" />
                            <h3 className="font-bold font-mono uppercase text-muted-foreground">Marketplace Offline</h3>
                            <p className="font-mono text-xs text-muted-foreground mt-2">NO AGENTS DETECTED IN THE REGISTRY.</p>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

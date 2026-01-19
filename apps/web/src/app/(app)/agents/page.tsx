"use client";

import { useEffect, useState } from 'react';
import { Bot, ShoppingBag, Plus, Sparkles, Zap, Layers, Terminal, Cpu, Loader2, Play } from 'lucide-react';
import Link from 'next/link';
import { getMarketAgents, rentAgent, MarketAgent } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

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
            alert('Failed to load AI agents from marketplace.');
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
            await rentAgent(agent.id, `${agent.name} Instance`, {});
            alert(`${agent.name} has been added to your instances.`);
        } catch (error) {
            console.error('Failed to rent agent:', error);
            alert('Rental Failed. Ensure you have enough balance in your TAO wallet.');
        } finally {
            setRentingId(null);
        }
    };

    return (
        <div className="p-8 space-y-8 animate-in fade-in duration-500">
            <div className="flex justify-between items-end">
                <div>
                    <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-400">
                        AI Agent Marketplace
                    </h1>
                    <p className="text-muted-foreground mt-1">Autonomous intelligence at your service</p>
                </div>
                <div className="flex gap-3">
                    <Link href="/agents/instances">
                        <Button variant="outline" className="bg-white/5 border-white/10 hover:bg-white/10">
                            <Layers className="mr-2 h-4 w-4 text-blue-400" />
                            My Instances
                        </Button>
                    </Link>
                    <Button className="bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20">
                        <Plus className="mr-2 h-4 w-4" />
                        Create Agent
                    </Button>
                </div>
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center min-h-[60vh]">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {agents.map((agent) => (
                            <Card key={agent.id} className="p-6 bg-card/50 backdrop-blur-sm border-white/5 hover:border-primary/20 transition-all group">
                                <div className="flex justify-between items-start mb-4">
                                    <div className="p-3 rounded-xl bg-primary/10 text-primary group-hover:scale-110 transition-transform">
                                        <Bot size={24} />
                                    </div>
                                    <Badge variant="secondary" className="bg-white/5 hover:bg-white/10">
                                        v{agent.version}
                                    </Badge>
                                </div>

                                <h3 className="text-xl font-bold mb-2">{agent.name}</h3>
                                <p className="text-sm text-muted-foreground mb-4 line-clamp-2 h-10">
                                    {agent.description || "No description provided."}
                                </p>

                                <div className="flex flex-wrap gap-2 mb-6">
                                    {agent.categories?.map((cat) => (
                                        <Badge key={cat} variant="outline" className="text-xs border-white/10">
                                            {cat}
                                        </Badge>
                                    ))}
                                </div>

                                <div className="flex items-center justify-between pt-4 border-t border-white/5">
                                    <div className="flex flex-col">
                                        <span className="text-xs text-muted-foreground">Price per run</span>
                                        <span className="font-bold font-mono">{agent.price_per_run} Credits</span>
                                    </div>
                                    <Button
                                        onClick={() => handleRent(agent)}
                                        disabled={!!rentingId}
                                        className="bg-primary hover:bg-primary/90"
                                    >
                                        {rentingId === agent.id ? (
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : (
                                            <>
                                                Deploy
                                                <Play className="ml-2 h-3 w-3" />
                                            </>
                                        )}
                                    </Button>
                                </div>
                            </Card>
                        ))}
                    </div>

                    {agents.length === 0 && (
                        <div className="text-center py-20 bg-card/30 rounded-2xl border border-dashed border-white/10">
                            <Cpu className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
                            <h3 className="text-lg font-medium">No Agents Available yet</h3>
                            <p className="text-muted-foreground text-sm">Be the first to publish an agent to the marketplace!</p>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

"use client";

import { useEffect, useState } from 'react';
import { Bot, ShoppingBag, Plus, Sparkles, Zap, Layers } from 'lucide-react';
import Link from 'next/link';
import { getMarketAgents, rentAgent, MarketAgent } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Play } from 'lucide-react'; // Added back for the button loader/play icon

export default function AgentsPage() {
    const [agents, setAgents] = useState<MarketAgent[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [rentingId, setRentingId] = useState<string | null>(null); // Re-added for rent button state
    const { toast } = useToast();

    const fetchAgents = async () => {
        try {
            const data = await getMarketAgents();
            setAgents(data);
        } catch (error) {
            console.error('Failed to fetch agents:', error);
            toast({
                title: 'Error',
                description: 'Failed to load AI agents from marketplace.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchAgents();
    }, []);

    const handleRent = async (agent: MarketAgent) => {
        setRentingId(agent.id); // Set renting state
        try {
            await rentAgent(agent.id, `${agent.name} Instance`, {}); // Re-added instance name and empty config
            toast({
                title: 'Success!',
                description: `${agent.name} has been added to your instances.`,
            });
            // Optionally redirect or refresh instances list
        } catch (error) {
            console.error('Failed to rent agent:', error);
            toast({
                title: 'Rental Failed',
                description: 'Ensure you have enough balance in your TAO wallet.',
                variant: 'destructive',
            });
        } finally {
            setRentingId(null); // Reset renting state
        }
    };

    if (isLoading) { // Changed from 'loading' to 'isLoading'
        return (
                </div >
            <Button variant="outline" onClick={() => router.push('/agents/instances')}>
                <Terminal className="mr-2 h-4 w-4" />
                My Instances
            </Button>
            </div >

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

        {
            agents.length === 0 && (
                <div className="text-center py-20 bg-card/30 rounded-2xl border border-dashed border-white/10">
                    <Cpu className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
                    <h3 className="text-lg font-medium">No Agents Available yet</h3>
                    <p className="text-muted-foreground text-sm">Be the first to publish an agent to the marketplace!</p>
                </div>
            )
        }
        </div >
    );
    }

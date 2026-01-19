'use client';

import { useEffect, useState } from 'react';
import { Bot, Play, Square, Settings, RefreshCw, Layers } from 'lucide-react';
import { getAgentInstances, AgentInstance } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';

export default function AgentInstancesPage() {
    const [instances, setInstances] = useState<AgentInstance[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const { toast } = useToast();

    const fetchInstances = async () => {
        try {
            const data = await getAgentInstances();
            setInstances(data);
        } catch (error) {
            console.error('Failed to fetch instances:', error);
            toast({
                title: 'Error',
                description: 'Failed to load your AI agent instances.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchInstances();
    }, []);

    const getStatusColor = (status: string) => {
        switch (status.toLowerCase()) {
            case 'running': return 'bg-green-500/20 text-green-400 border-green-500/50';
            case 'stopped': return 'bg-red-500/20 text-red-400 border-red-500/50';
            case 'pending': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50';
            default: return 'bg-gray-500/20 text-gray-400 border-gray-500/50';
        }
    };

    return (
        <div className="p-8 space-y-8 animate-in fade-in duration-500">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-400">
                        My Agent Instances
                    </h1>
                    <p className="text-muted-foreground mt-1">Manage and monitor your active AI agents</p>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={fetchInstances}
                    className="bg-white/5 border-white/10 hover:bg-white/10"
                >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Refresh
                </Button>
            </div>

            {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="h-64 bg-white/5 animate-pulse rounded-2xl border border-white/10" />
                    ))}
                </div>
            ) : instances.length === 0 ? (
                <GlassCard className="flex flex-col items-center justify-center py-20 text-center">
                    <div className="bg-blue-500/10 p-4 rounded-full mb-4">
                        <Bot className="h-12 w-12 text-blue-400" />
                    </div>
                    <h3 className="text-xl font-bold mb-2">No Instances Found</h3>
                    <p className="text-muted-foreground mb-6 max-w-xs">
                        You haven't rented any AI agents yet. Visit the Marketplace to get started.
                    </p>
                    <Button onClick={() => window.location.href = '/agents'}>
                        Browse Marketplace
                    </Button>
                </GlassCard>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {instances.map((instance) => (
                        <GlassCard key={instance.id} className="group relative overflow-hidden border-white/10 hover:border-blue-500/30 transition-all duration-300">
                            <div className="flex justify-between items-start mb-4">
                                <div className="flex items-center gap-3">
                                    <div className="bg-gradient-to-br from-blue-600/20 to-indigo-600/20 p-2.5 rounded-xl border border-white/10 group-hover:scale-110 transition-transform duration-300">
                                        <Bot className="h-5 w-5 text-blue-400" />
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-white leading-tight">{instance.agent?.name}</h3>
                                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                                            ID: {instance.id.split('-')[0]}
                                        </p>
                                    </div>
                                </div>
                                <Badge className={getStatusColor(instance.status)}>
                                    {instance.status}
                                </Badge>
                            </div>

                            <div className="space-y-3 mb-6">
                                <div className="flex justify-between text-xs py-2 border-b border-white/5">
                                    <span className="text-muted-foreground">Expires</span>
                                    <span className="text-white font-medium">
                                        {instance.expires_at ? new Date(instance.expires_at).toLocaleDateString() : 'N/A'}
                                    </span>
                                </div>
                                <div className="flex justify-between text-xs py-2 border-b border-white/5">
                                    <span className="text-muted-foreground">Active Jobs</span>
                                    <span className="text-blue-400 font-bold">0</span>
                                </div>
                            </div>

                            <div className="flex gap-2">
                                <Button variant="outline" className="flex-1 bg-white/5 border-white/10 hover:bg-white/10 group-hover:border-blue-500/30">
                                    <Play className="mr-2 h-4 w-4 text-green-400" />
                                    Run
                                </Button>
                                <Button variant="outline" className="w-12 bg-white/5 border-white/10 hover:bg-white/10 p-0">
                                    <Settings className="h-4 w-4 text-muted-foreground" />
                                </Button>
                            </div>
                        </GlassCard>
                    ))}
                </div>
            )}
        </div>
    );
}

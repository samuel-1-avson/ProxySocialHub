"use client";

import { useEffect, useState } from 'react';
import { Bot, Play, Settings, RefreshCw, Cpu, Loader2 } from 'lucide-react';
import { getMyAgents, AgentInstance } from '@/lib/api';
import { ROUTES } from '@/lib/navigation/routes';

export default function AgentInstancesPage() {
    const [instances, setInstances] = useState<AgentInstance[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const fetchInstances = async () => {
        try {
            const data = await getMyAgents();
            setInstances(data);
        } catch (error) {
            console.error('Failed to fetch instances:', error);
            // alert('Failed to load your AI agent instances.');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchInstances();
    }, []);

    const getStatusColor = (status: string) => {
        switch (status.toLowerCase()) {
            case 'running': return 'text-green-500 border-green-500/50 bg-green-500/10';
            case 'stopped': return 'text-red-500 border-red-500/50 bg-red-500/10';
            case 'pending': return 'text-yellow-500 border-yellow-500/50 bg-yellow-500/10';
            default: return 'text-muted-foreground border-border bg-secondary';
        }
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500 pb-20">
            <div className="flex justify-between items-center border-b border-border pb-6">
                <div>
                    <h1 className="text-3xl font-bold font-mono uppercase tracking-tight mb-1">
                        Active Instances
                    </h1>
                    <p className="text-muted-foreground font-mono text-xs">MANAGE AND MONITOR RUNNING PROCESSES.</p>
                </div>
                <button
                    onClick={fetchInstances}
                    className="btn-retro btn-retro-outline bg-background flex items-center gap-2"
                >
                    <RefreshCw size={14} />
                    REFRESH
                </button>
            </div>

            {isLoading ? (
                <div className="flex flex-col items-center justify-center py-40 gap-4">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Scanning Instances...</p>
                </div>
            ) : instances.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed border-border rounded-sm bg-secondary/10 text-center">
                    <div className="p-4 bg-secondary rounded-full mb-4">
                        <Bot className="h-10 w-10 text-muted-foreground" />
                    </div>
                    <h3 className="font-bold font-mono uppercase text-lg">No Active Instances</h3>
                    <p className="font-mono text-xs text-muted-foreground mt-2 max-w-xs mx-auto mb-6">
                        YOU HAVE NOT DEPLOYED ANY AGENTS YET.
                    </p>
                    <a href={ROUTES.marketplaceAgents} className="btn-retro btn-retro-primary">
                        BROWSE MARKETPLACE
                    </a>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {instances.map((instance) => (
                        <div key={instance.id} className="card-retro p-6 bg-card group hover:border-primary transition-all">
                            <div className="flex justify-between items-start mb-6">
                                <div className="flex items-center gap-3">
                                    <div className="p-2.5 rounded-sm bg-primary/10 border border-primary/20 group-hover:scale-110 transition-transform">
                                        <Bot className="h-5 w-5 text-primary" />
                                    </div>
                                    <div>
                                        <h3 className="font-bold font-mono text-sm leading-tight uppercase">{instance.market_agent?.name}</h3>
                                        <p className="text-[10px] font-mono text-muted-foreground/70 font-bold mt-0.5">
                                            ID: {instance.id.split('-')[0].toUpperCase()}
                                        </p>
                                    </div>
                                </div>
                                <span className={`px-2 py-0.5 rounded-sm border text-[10px] font-mono font-bold uppercase ${getStatusColor(instance.status)}`}>
                                    {instance.status}
                                </span>
                            </div>

                            <div className="space-y-3 mb-6 p-4 bg-secondary/20 rounded-sm border border-border/50">
                                <div className="flex justify-between items-center text-xs font-mono">
                                    <span className="text-muted-foreground">EXPIRES</span>
                                    <span className="font-bold text-foreground">
                                        {instance.expires_at ? new Date(instance.expires_at).toLocaleDateString() : 'PERMANENT'}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center text-xs font-mono">
                                    <span className="text-muted-foreground">ACTIVE JOBS</span>
                                    <span className="text-primary font-bold">0</span>
                                </div>
                            </div>

                            <div className="flex gap-2">
                                <button className="flex-1 btn-retro btn-retro-outline bg-background flex items-center justify-center gap-2 group-hover:border-primary/50 text-xs">
                                    <Play size={12} className="text-green-500" />
                                    EXECUTE
                                </button>
                                <button className="w-10 btn-retro btn-retro-outline bg-background flex items-center justify-center p-0">
                                    <Settings size={14} className="text-muted-foreground" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

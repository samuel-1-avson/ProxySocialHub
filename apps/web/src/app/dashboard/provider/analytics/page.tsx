"use client";

import { useEffect, useState } from 'react';
import { getProviderNodes, ProviderNode } from '@/lib/services/market';
import { ProviderScoreCard } from '@/components/ProviderScoreCard';
import { Loader2, Server, BarChart2 } from 'lucide-react';

export default function ProviderAnalyticsPage() {
    const [nodes, setNodes] = useState<ProviderNode[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchNodes() {
            try {
                const data = await getProviderNodes();
                setNodes(data.nodes);
            } catch (error) {
                console.error("Failed to fetch provider nodes", error);
            } finally {
                setLoading(false);
            }
        }
        fetchNodes();
    }, []);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh]">
                <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
                <p className="text-xs font-mono uppercase text-muted-foreground">Analyzing Network Performance...</p>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-500 pb-20">
            {/* Header */}
            <div className="flex flex-col gap-2 border-b border-border pb-6">
                <div className="flex items-center gap-2 text-primary font-mono text-xs font-bold uppercase tracking-widest">
                    <BarChart2 size={14} />
                    Performance Analytics
                </div>
                <h1 className="text-3xl font-bold font-mono uppercase tracking-tight">Provider Scorecard</h1>
                <p className="text-muted-foreground font-mono text-xs max-w-lg">
                    REAL-TIME TRUST METRICS AND NODE PERORMANCE.
                </p>
            </div>

            {/* Content */}
            {nodes.length === 0 ? (
                <div className="p-12 border border-dashed border-border rounded-sm text-center bg-secondary/5">
                    <Server size={48} className="mx-auto text-muted-foreground mb-4 opacity-50" />
                    <h3 className="text-sm font-bold font-mono uppercase text-muted-foreground mb-2">No Active Nodes</h3>
                    <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                        Register a provider node to start accumulating trust score and earning rewards.
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                    {nodes.map(node => (
                        <ProviderScoreCard key={node.id} node={node} />
                    ))}
                </div>
            )}
        </div>
    );
}

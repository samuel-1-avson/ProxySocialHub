import { ProviderNode } from '@/lib/api/marketplace';
import { Shield, Clock, Wifi, Award, TrendingUp, AlertTriangle } from 'lucide-react';

interface ProviderScoreCardProps {
    node: ProviderNode;
}

export function ProviderScoreCard({ node }: ProviderScoreCardProps) {
    // Calculate tier based on score
    const score = node.quality_score || 0;
    let tier = 'Standard';
    let tierColor = 'text-muted-foreground';
    let borderColor = 'border-border';
    let bgGradient = 'bg-card';

    if (score >= 90) {
        tier = 'Platinum';
        tierColor = 'text-info';
        borderColor = 'border-info/50';
        bgGradient = 'bg-gradient-to-br from-info/10 to-transparent';
    } else if (score >= 80) {
        tier = 'Gold';
        tierColor = 'text-warning';
        borderColor = 'border-warning/50';
        bgGradient = 'bg-gradient-to-br from-warning/10 to-transparent';
    } else if (score >= 70) {
        tier = 'Silver';
        tierColor = 'text-muted-foreground';
        borderColor = 'border-border';
    }

    return (
        <div className={`card-retro p-6 ${borderColor} ${bgGradient} relative overflow-hidden group`}>
            {/* Background Decor */}
            <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
                <Award size={120} />
            </div>

            <div className="relative z-10 grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Main Score */}
                <div className="flex flex-col items-center justify-center p-4 border border-border bg-background/50 rounded-sm">
                    <div className="text-xs font-mono font-bold text-muted-foreground mb-2 flex items-center gap-1">
                        <Shield size={12} /> Trust Score
                    </div>
                    <div className={`text-5xl font-semibold font-mono tracking-tight ${tierColor}`}>
                        {Number(score || 0).toFixed(1)}
                    </div>
                    <div className={`mt-2 px-3 py-1 text-xs font-bold rounded-full border ${borderColor} ${tierColor} bg-background`}>
                        {tier} Tier
                    </div>
                </div>

                {/* Metrics */}
                <div className="col-span-2 grid grid-cols-2 gap-4">
                    <div className="p-4 bg-secondary/10 rounded-sm">
                        <div className="flex items-center gap-2 mb-2">
                            <Clock size={14} className="text-success" />
                            <span className="text-xs font-bold font-mono text-muted-foreground">Uptime</span>
                        </div>
                        <div className="text-2xl font-bold font-mono">
                            {node.uptime_percent ? Number(node.uptime_percent).toFixed(1) + '%' : 'N/A'}
                        </div>
                        <div className="h-1 w-full bg-secondary mt-2 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-success rounded-full"
                                style={{ width: `${node.uptime_percent || 0}%` }}
                            ></div>
                        </div>
                    </div>

                    <div className="p-4 bg-secondary/10 rounded-sm">
                        <div className="flex items-center gap-2 mb-2">
                            <Wifi size={14} className="text-info" />
                            <span className="text-xs font-bold font-mono text-muted-foreground">Latency</span>
                        </div>
                        <div className="text-2xl font-bold font-mono">
                            {node.latency_ms || '-'} <span className="text-sm text-muted-foreground">ms</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                            {node.latency_ms && node.latency_ms < 50 ? 'Excellent' : node.latency_ms && node.latency_ms < 150 ? 'Good' : 'Fair'}
                        </p>
                    </div>

                    <div className="p-4 bg-secondary/10 rounded-sm">
                        <div className="flex items-center gap-2 mb-2">
                            <TrendingUp size={14} className="text-primary" />
                            <span className="text-xs font-bold font-mono text-muted-foreground">Traffic</span>
                        </div>
                        <div className="text-xl font-bold font-mono">
                            {node.active_connections || 0} <span className="text-sm text-muted-foreground">Active</span>
                        </div>
                    </div>

                    <div className="p-4 bg-secondary/10 rounded-sm">
                        <div className="flex items-center gap-2 mb-2">
                            <AlertTriangle size={14} className="text-warning" />
                            <span className="text-xs font-bold font-mono text-muted-foreground">Disputes</span>
                        </div>
                        <div className="text-xl font-bold font-mono">
                            0 <span className="text-sm text-muted-foreground">Open</span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="mt-6 pt-4 border-t border-border flex justify-between items-center text-xs text-muted-foreground font-mono">
                <span>Node ID: {node.id.slice(0, 12)}...</span>
                <span>Last Updated: Just now</span>
            </div>
        </div>
    );
}

import { ProviderNode } from '@/lib/api/marketplace';
import { Shield, Clock, Wifi, Award, TrendingUp, AlertTriangle } from 'lucide-react';
import { measurement, measured } from '@/lib/measurements';

interface ProviderScoreCardProps {
    node: ProviderNode;
}

export function ProviderScoreCard({ node }: ProviderScoreCardProps) {
    // Calculate tier based on score
    const score = measurement(node.quality_score);
    let tierColor = 'text-muted-foreground';
    let borderColor = 'border-border';
    let bgGradient = 'bg-card';

    if (score !== undefined && score >= 90) {
        tierColor = 'text-cyan-400';
        borderColor = 'border-cyan-500/50';
        bgGradient = 'bg-gradient-to-br from-cyan-900/10 to-transparent';
    } else if (score !== undefined && score >= 80) {
        tierColor = 'text-yellow-400';
        borderColor = 'border-yellow-500/50';
        bgGradient = 'bg-gradient-to-br from-yellow-900/10 to-transparent';
    } else if (score !== undefined && score >= 70) {
        tierColor = 'text-slate-300';
        borderColor = 'border-slate-400/50';
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
                    <div className="text-[10px] font-mono font-bold uppercase text-muted-foreground mb-2 flex items-center gap-1">
                        <Shield size={12} /> Trust Score
                    </div>
                    <div className={`text-5xl font-black font-mono tracking-tighter ${tierColor}`}>
                        {measured(score, 1)}
                    </div>
                    <div className={`mt-2 px-3 py-1 text-[10px] font-bold uppercase rounded-full border ${borderColor} ${tierColor} bg-background`}>
                        Reported score
                    </div>
                </div>

                {/* Metrics */}
                <div className="col-span-2 grid grid-cols-2 gap-4">
                    <div className="p-4 bg-secondary/10 rounded-sm">
                        <div className="flex items-center gap-2 mb-2">
                            <Clock size={14} className="text-green-500" />
                            <span className="text-[10px] font-bold font-mono uppercase text-muted-foreground">Uptime</span>
                        </div>
                        <div className="text-2xl font-bold font-mono">
                            {measured(node.uptime_percent, 1, '%')}
                        </div>
                        <div className="h-1 w-full bg-secondary mt-2 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-green-500 rounded-full"
                                style={{ width: `${node.uptime_percent || 0}%` }}
                            ></div>
                        </div>
                    </div>

                    <div className="p-4 bg-secondary/10 rounded-sm">
                        <div className="flex items-center gap-2 mb-2">
                            <Wifi size={14} className="text-blue-500" />
                            <span className="text-[10px] font-bold font-mono uppercase text-muted-foreground">Latency</span>
                        </div>
                        <div className="text-2xl font-bold font-mono">
                            {measured(node.latency_ms, 1, 'ms')}
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1">
                            {node.latency_ms != null ? 'Reported response time' : 'No response-time measurement'}
                        </p>
                    </div>

                    <div className="p-4 bg-secondary/10 rounded-sm">
                        <div className="flex items-center gap-2 mb-2">
                            <TrendingUp size={14} className="text-purple-500" />
                            <span className="text-[10px] font-bold font-mono uppercase text-muted-foreground">Traffic</span>
                        </div>
                        <div className="text-xl font-bold font-mono">
                            {measured(node.active_connections, 0)} <span className="text-sm text-muted-foreground">Active</span>
                        </div>
                    </div>

                    <div className="p-4 bg-secondary/10 rounded-sm">
                        <div className="flex items-center gap-2 mb-2">
                            <AlertTriangle size={14} className="text-yellow-500" />
                            <span className="text-[10px] font-bold font-mono uppercase text-muted-foreground">Disputes</span>
                        </div>
                        <div className="text-xl font-bold font-mono">
                            Not reported
                        </div>
                    </div>
                </div>
            </div>

            <div className="mt-6 pt-4 border-t border-border flex justify-between items-center text-xs text-muted-foreground font-mono">
                <span>Node ID: {node.id.slice(0, 12)}...</span>
                <span>Source timestamp not reported</span>
            </div>
        </div>
    );
}

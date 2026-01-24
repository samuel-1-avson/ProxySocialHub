import { Session } from '@/lib/services/market';
import { Activity, Clock, ShieldCheck, Square, Zap, HardDrive } from 'lucide-react';
import { useEffect, useState } from 'react';

interface StreamingSessionCardProps {
    session: Session;
    onTerminate: (id: string) => void;
}

export function StreamingSessionCard({ session, onTerminate }: StreamingSessionCardProps) {
    const [elapsed, setElapsed] = useState(0);
    const [cost, setCost] = useState(0);

    // Calculate real-time stats
    useEffect(() => {
        if (session.status !== 'active') return;

        const startTime = new Date(session.created_at).getTime();
        const pricePerHour = session.listing?.price_per_hour || 0.1; // Default fallback
        const pricePerMs = pricePerHour / 3600000;

        const interval = setInterval(() => {
            const now = Date.now();
            const diff = now - startTime;
            setElapsed(Math.floor(diff / 1000));
            setCost(diff * pricePerMs);
        }, 100); // Fast updates for "streaming" effect

        return () => clearInterval(interval);
    }, [session]);

    // Format helpers
    const formatTime = (seconds: number) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    return (
        <div className="card-retro p-0 bg-card overflow-hidden group border-green-500/30 shadow-[0_0_15px_rgba(34,197,94,0.1)]">
            {/* Header / Status Bar */}
            <div className="px-5 py-3 bg-secondary/10 border-b border-border flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <Activity size={16} className="text-green-500" />
                        <span className="absolute -top-1 -right-1 w-2 h-2 bg-green-500 rounded-full animate-ping"></span>
                    </div>
                    <h3 className="text-xs font-bold font-mono uppercase text-green-500 tracking-wider">Stream Active</h3>
                </div>
                <div className="text-[10px] font-mono text-muted-foreground uppercase flex gap-2">
                    <span>ID: {session.id.slice(0, 8)}</span>
                </div>
            </div>

            {/* Main Viz */}
            <div className="p-6 grid grid-cols-2 gap-6 relative">
                {/* Background Grid Animation */}
                <div className="absolute inset-0 bg-[linear-gradient(rgba(34,197,94,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(34,197,94,0.03)_1px,transparent_1px)] bg-[size:20px_20px] pointer-events-none"></div>

                {/* Left: Vested Amount */}
                <div className="z-10">
                    <p className="text-[10px] font-mono font-bold uppercase text-muted-foreground mb-1">Vested Amount</p>
                    <div className="text-3xl font-black font-mono tracking-tighter text-white flex items-baseline gap-1">
                        {cost.toFixed(6)} <span className="text-sm text-green-500">TAO</span>
                    </div>
                    <div className="flex items-center gap-1 mt-2 text-[10px] font-mono text-green-400/80">
                        <Zap size={10} />
                        Rate: {(session.listing?.price_per_hour || 0.1).toFixed(3)} TAO/hr
                    </div>
                </div>

                {/* Right: Time & Bytes */}
                <div className="z-10 flex flex-col justify-between items-end text-right">
                    <div>
                        <p className="text-[10px] font-mono font-bold uppercase text-muted-foreground mb-1">Duration</p>
                        <div className="text-xl font-bold font-mono text-white flex items-center justify-end gap-2">
                            {formatTime(elapsed)}
                            <Clock size={14} className="animate-pulse text-green-500" />
                        </div>
                    </div>

                    <div className="mt-4">
                        <p className="text-[10px] font-mono font-bold uppercase text-muted-foreground mb-1">Data Usage</p>
                        <div className="text-md font-bold font-mono text-white flex items-center justify-end gap-2">
                            {((session.bytes_used || 0) / (1024 * 1024)).toFixed(2)} MB
                            <HardDrive size={12} className="text-blue-400" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Footer / Controls */}
            <div className="p-4 bg-secondary/5 border-t border-border flex justify-between items-center">
                <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
                    <ShieldCheck size={12} className="text-blue-500" />
                    <span>On-Chain Escrow: {session.tx_hash?.slice(0, 6) || 'Pending'}...</span>
                </div>

                <button
                    onClick={() => onTerminate(session.id)}
                    className="flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 hover:border-red-500/50 rounded-sm text-xs font-bold font-mono uppercase transition-all"
                >
                    <Square size={12} fill="currentColor" /> Stop Stream
                </button>
            </div>

            {/* Progress Bar (Time Remaining or Funds Remaining visualization) */}
            <div className="h-0.5 w-full bg-secondary/30">
                <div className="h-full bg-green-500 animate-pulse w-full origin-left"></div>
            </div>
        </div>
    );
}

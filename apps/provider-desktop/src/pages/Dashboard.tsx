import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CheckCircle, XCircle, Zap, TrendingUp, Activity, BarChart3 } from "lucide-react";

interface ProviderStats {
    connected: boolean;
    total_bytes_up: number;
    total_bytes_down: number;
    total_gb: number;
    total_connections: number;
    active_connections: number;
    earnings_ghs: number;
    session_duration_secs: number;
    within_schedule: boolean;
    within_bandwidth_limit: boolean;
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export function Dashboard() {
    const [stats, setStats] = useState<ProviderStats | null>(null);
    const [connecting, setConnecting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const interval = setInterval(async () => {
            try {
                const data = await invoke<ProviderStats>("get_provider_stats");
                setStats(data);
            } catch (e) {
                console.error("Failed to get stats:", e);
            }
        }, 2000);

        invoke<ProviderStats>("get_provider_stats").then(setStats);
        return () => clearInterval(interval);
    }, []);

    async function toggleNode() {
        if (stats?.connected) {
            try {
                await invoke("disconnect_gateway");
            } catch (e) {
                setError(String(e));
            }
        } else {
            setConnecting(true);
            setError(null);
            try {
                // In production these would come from settings/auth
                const url = "127.0.0.1:4000";
                const token = localStorage.getItem("proxyhubb_token") || "";
                await invoke("connect_gateway", { gatewayUrl: url, authKey: token });
            } catch (e) {
                setError(String(e));
            } finally {
                setConnecting(false);
            }
        }
    }

    return (
        <div className="space-y-8">
            {/* Page Header */}
            <div>
                <h1 className="text-4xl font-mono font-black uppercase tracking-tight">System_Overview</h1>
                <p className="text-muted-foreground font-mono text-sm uppercase tracking-widest mt-2">Real-time status and analytics</p>
            </div>

            {/* Matrix Status Card */}
            <div className="card-retro p-8 bg-card flex flex-col md:flex-row items-center justify-between gap-8 border-l-8 border-primary">
                <div className="flex items-center gap-6">
                    <div className="relative">
                        {stats?.connected ? (
                            <div className="w-20 h-20 bg-primary/10 rounded-sm border-2 border-primary flex items-center justify-center">
                                <Zap className="w-10 h-10 text-primary animate-pulse" />
                            </div>
                        ) : (
                            <div className="w-20 h-20 bg-muted rounded-sm border-2 border-border flex items-center justify-center">
                                <XCircle className="w-10 h-10 text-muted-foreground" />
                            </div>
                        )}
                        {stats?.connected && (
                            <span className="absolute -top-1 -right-1 flex h-4 w-4">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-4 w-4 bg-primary"></span>
                            </span>
                        )}
                    </div>
                    <div>
                        <h2 className="text-2xl font-mono font-bold uppercase">{stats?.connected ? "Node_Online" : "Node_Offline"}</h2>
                        <p className="font-mono text-sm text-muted-foreground">Gateway: 127.0.0.1:4000</p>
                        {stats?.active_connections ? (
                            <div className="flex items-center gap-2 mt-2">
                                <Activity className="w-3 h-3 text-primary" />
                                <span className="text-xs font-mono font-bold text-primary uppercase">{stats.active_connections} ACTIVE_TUNNELS</span>
                            </div>
                        ) : null}
                    </div>
                </div>

                <div className="flex flex-col gap-2 w-full md:w-auto">
                    <button
                        onClick={toggleNode}
                        className={`btn-retro ${stats?.connected ? "btn-retro-outline border-destructive text-destructive hover:bg-destructive/10" : "btn-retro-primary"} py-4 px-10 text-sm font-bold uppercase tracking-widest`}
                        disabled={connecting}
                    >
                        {connecting ? "INITIALIZING..." : (stats?.connected ? "TERMINATE_NODE" : "START_NODE")}
                    </button>
                    {error && <p className="text-[10px] font-mono text-destructive uppercase text-center mt-2 font-bold">{error}</p>}
                </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 tracking-tight">
                <div className="card-retro p-6 bg-card border-b-4 border-b-primary shadow-sm hover:translate-y-[-4px] transition-all">
                    <div className="flex items-center gap-3 mb-4 text-muted-foreground">
                        <TrendingUp className="w-4 h-4" />
                        <span className="text-[10px] font-mono font-bold uppercase tracking-widest">Revenue_GHS</span>
                    </div>
                    <div className="text-3xl font-mono font-black">₵{(stats?.earnings_ghs ?? 0).toFixed(4)}</div>
                    <div className="text-[10px] font-mono text-primary font-bold mt-2 uppercase">EST_YIELD_PER_GB: ₵0.20</div>
                </div>

                <div className="card-retro p-6 bg-card border-b-4 border-b-border shadow-sm hover:translate-y-[-4px] transition-all">
                    <div className="flex items-center gap-3 mb-4 text-muted-foreground">
                        <BarChart3 className="w-4 h-4" />
                        <span className="text-[10px] font-mono font-bold uppercase tracking-widest">Data_Sent</span>
                    </div>
                    <div className="text-3xl font-mono font-black">{formatBytes(stats?.total_bytes_up || 0)}</div>
                </div>

                <div className="card-retro p-6 bg-card border-b-4 border-b-border shadow-sm hover:translate-y-[-4px] transition-all">
                    <div className="flex items-center gap-3 mb-4 text-muted-foreground">
                        <BarChart3 className="w-4 h-4" />
                        <span className="text-[10px] font-mono font-bold uppercase tracking-widest">Data_Received</span>
                    </div>
                    <div className="text-3xl font-mono font-black">{formatBytes(stats?.total_bytes_down || 0)}</div>
                </div>

                <div className="card-retro p-6 bg-card border-b-4 border-b-border shadow-sm hover:translate-y-[-4px] transition-all">
                    <div className="flex items-center gap-3 mb-4 text-muted-foreground">
                        <Activity className="w-4 h-4" />
                        <span className="text-[10px] font-mono font-bold uppercase tracking-widest">Uptime_Session</span>
                    </div>
                    <div className="text-3xl font-mono font-black">
                        {Math.floor((stats?.session_duration_secs || 0) / 60)}m {(stats?.session_duration_secs || 0) % 60}s
                    </div>
                </div>
            </div>

            {/* Performance Tips */}
            <div className="card-retro p-6 bg-secondary/30 border-dashed border-2">
                <h4 className="font-mono font-bold text-sm uppercase tracking-widest mb-4 flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-primary" /> System_Optimization_Guidelines
                </h4>
                <ul className="grid md:grid-cols-3 gap-6 text-xs font-mono text-muted-foreground uppercase leading-relaxed">
                    <li className="flex gap-3">
                        <span className="text-primary font-black">[01]</span>
                        <span>Join a High-Performance Circle to unlock multiplier bonuses.</span>
                    </li>
                    <li className="flex gap-3">
                        <span className="text-primary font-black">[02]</span>
                        <span>Keep your node active during peak hours (18:00 - 23:00) for max yield.</span>
                    </li>
                    <li className="flex gap-3">
                        <span className="text-primary font-black">[03]</span>
                        <span>Maintain a low latency score (&lt;50ms) to tier up your node quality.</span>
                    </li>
                </ul>
            </div>
        </div>
    );
}

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { Globe, Settings, CheckCircle, XCircle, LogOut, LayoutDashboard, ShoppingCart, Users, Wallet } from "lucide-react";
import { auth } from "../lib/api";
import { CirclesTab } from "../components/CirclesTab";
import { MarketplaceTab } from "../components/MarketplaceTab";

// Reusing types from App.tsx (would be better in a shared types file)
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

interface ProviderSettings {
    auto_connect: boolean;
    auto_reconnect: boolean;
    reconnect_delay_secs: number;
    max_reconnect_attempts: number;
    daily_bandwidth_limit_gb: number;
    monthly_bandwidth_limit_gb: number;
    schedule_enabled: boolean;
    schedule_start_hour: number;
    schedule_end_hour: number;
    schedule_days: string[];
    gateway_url: string;
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}


export function Dashboard() {
    const navigate = useNavigate();
    const [stats, setStats] = useState<ProviderStats | null>(null);
    const [settings, setSettings] = useState<ProviderSettings | null>(null);
    const [connecting, setConnecting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Tab State
    const [activeTab, setActiveTab] = useState<"overview" | "marketplace" | "circles">("overview");

    // Auth Check
    useEffect(() => {
        if (!auth.isAuthenticated()) {
            navigate("/login");
        }
    }, [navigate]);

    // Refresh stats every 2 seconds
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
        invoke<ProviderSettings>("get_settings").then(setSettings);

        return () => clearInterval(interval);
    }, []);

    async function connect() {
        setConnecting(true);
        setError(null);
        try {
            const url = settings?.gateway_url || "127.0.0.1:4000";
            const user = auth.getUser();
            if (!user) throw new Error("Not authenticated");
            const token = localStorage.getItem("auth_token") || "";
            if (!token) throw new Error("No auth token found");

            await invoke("connect_gateway", { gatewayUrl: url, authKey: token });
        } catch (e) {
            setError(String(e));
        } finally {
            setConnecting(false);
        }
    }

    async function disconnect() {
        try {
            await invoke("disconnect_gateway");
        } catch (e) {
            setError(String(e));
        }
    }

    function handleLogout() {
        auth.logout();
        navigate("/login");
    }

    // Overview Tab Content
    const renderOverview = () => (
        <div className="space-y-6 p-6">
            {/* Simple Connection Card */}
            <div className="card bg-white dark:bg-gray-800 p-6 rounded-lg shadow border dark:border-gray-700">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-4">
                        {stats?.connected ?
                            <div className="relative">
                                <CheckCircle className="w-12 h-12 text-green-500" />
                                <span className="absolute top-0 right-0 w-3 h-3 bg-green-400 rounded-full animate-ping"></span>
                            </div> :
                            <XCircle className="w-12 h-12 text-gray-400" />
                        }
                        <div>
                            <h2 className="text-xl font-bold">{stats?.connected ? "Node Active" : "Node Offline"}</h2>
                            <p className="text-sm text-gray-500">Gateway: {settings?.gateway_url || "127.0.0.1:4000"}</p>
                            {stats?.active_connections ? (
                                <p className="text-xs text-blue-600 font-medium mt-1">{stats.active_connections} active tunnels</p>
                            ) : null}
                        </div>
                    </div>
                    <div>
                        {stats?.connected ? (
                            <button onClick={disconnect} className="bg-red-600 text-white px-6 py-2.5 rounded-lg hover:bg-red-700 font-medium transition-colors shadow-sm">Stop Node</button>
                        ) : (
                            <button onClick={connect} disabled={connecting} className="bg-green-600 text-white px-6 py-2.5 rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium transition-colors shadow-sm">
                                {connecting ? "Starting..." : "Start Node"}
                            </button>
                        )}
                    </div>
                </div>
                {error && <div className="mt-4 p-3 bg-red-100 text-red-700 rounded text-sm">{error}</div>}
            </div>

            {/* Stats Grid */}
            <h3 className="text-lg font-bold">Performance Analytics</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm border dark:border-gray-700">
                    <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
                        <Wallet className="w-4 h-4" /> Earnings
                    </div>
                    <div className="text-2xl font-bold text-gray-900 dark:text-white">GHS {(stats?.earnings_ghs ?? 0).toFixed(4)}</div>
                    <div className="text-xs text-green-600 mt-1">+0.00 this session</div>
                </div>
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm border dark:border-gray-700">
                    <div className="text-sm text-gray-500 mb-1">Uploaded</div>
                    <div className="text-2xl font-bold text-gray-900 dark:text-white">{formatBytes(stats?.total_bytes_up || 0)}</div>
                </div>
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm border dark:border-gray-700">
                    <div className="text-sm text-gray-500 mb-1">Downloaded</div>
                    <div className="text-2xl font-bold text-gray-900 dark:text-white">{formatBytes(stats?.total_bytes_down || 0)}</div>
                </div>
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm border dark:border-gray-700">
                    <div className="text-sm text-gray-500 mb-1">Uptime</div>
                    <div className="text-2xl font-bold text-gray-900 dark:text-white">
                        {Math.floor((stats?.session_duration_secs || 0) / 60)}m {(stats?.session_duration_secs || 0) % 60}s
                    </div>
                </div>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/10 p-4 rounded-lg border border-blue-100 dark:border-blue-900/30">
                <h4 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">💡 Tips to earn more</h4>
                <ul className="text-sm text-blue-800 dark:text-blue-200 list-disc list-inside space-y-1">
                    <li>Join a Circle to unlock multiplier bonuses.</li>
                    <li>Keep your node running during peak hours (18:00 - 23:00).</li>
                    <li>Ensure stable internet connection for higher quality score.</li>
                </ul>
            </div>
        </div>
    );

    return (
        <div className="provider-app h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
            {/* Header */}
            <header className="header flex justify-between items-center px-6 py-3 bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 z-10">
                <div className="flex items-center gap-2">
                    <Globe className="w-7 h-7 text-green-600" />
                    <span className="text-lg font-bold text-gray-900 dark:text-white tracking-tight">ProxySocialHub</span>
                </div>
                <div className="header-actions flex items-center gap-3">
                    <button
                        className="btn btn-ghost hover:bg-gray-100 dark:hover:bg-gray-700 p-2 rounded-full transition-colors"
                        onClick={() => alert("Settings modal not implemented yet")}
                        title="Settings"
                    >
                        <Settings className="w-5 h-5 text-gray-600 dark:text-gray-300" />
                    </button>
                    <button
                        className="btn btn-ghost hover:bg-red-50 dark:hover:bg-red-900/20 p-2 rounded-full text-red-600 transition-colors"
                        onClick={handleLogout}
                        title="Logout"
                    >
                        <LogOut className="w-5 h-5" />
                    </button>
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 ${stats?.connected ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                        <span className={`w-2 h-2 rounded-full ${stats?.connected ? "bg-green-500" : "bg-gray-400"}`}></span>
                        {stats?.connected ? "Online" : "Offline"}
                    </span>
                </div>
            </header>

            <div className="flex flex-1 overflow-hidden">
                {/* Sidebar Navigation */}
                <aside className="w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col">
                    <nav className="p-4 space-y-1">
                        <button
                            onClick={() => setActiveTab('overview')}
                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${activeTab === 'overview' ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400' : 'text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-700'}`}
                        >
                            <LayoutDashboard className="w-5 h-5" /> Overview
                        </button>
                        <button
                            onClick={() => setActiveTab('marketplace')}
                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${activeTab === 'marketplace' ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400' : 'text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-700'}`}
                        >
                            <ShoppingCart className="w-5 h-5" /> Marketplace
                        </button>
                        <button
                            onClick={() => setActiveTab('circles')}
                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${activeTab === 'circles' ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400' : 'text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-700'}`}
                        >
                            <Users className="w-5 h-5" /> Circles (Clans)
                        </button>
                    </nav>

                    <div className="mt-auto p-4 border-t dark:border-gray-700">
                        <div className="bg-gray-50 dark:bg-gray-700/50 rounded p-3">
                            <div className="text-xs text-gray-500 mb-1">Current Balance</div>
                            <div className="font-bold text-lg">GHS 0.00</div>
                            <button className="text-xs text-blue-600 hover:underline mt-1">Withdraw</button>
                        </div>
                    </div>
                </aside>

                {/* Main Content Area */}
                <main className="flex-1 overflow-auto bg-gray-50 dark:bg-gray-900">
                    {activeTab === 'overview' && renderOverview()}
                    {activeTab === 'marketplace' && <MarketplaceTab />}
                    {activeTab === 'circles' && <CirclesTab />}
                </main>
            </div>
        </div>
    );
}

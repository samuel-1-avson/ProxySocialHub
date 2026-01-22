import { useState, useEffect } from "react";
import { fetchWithAuth } from "../lib/auth-util";
import {
    Wallet as WalletIcon,
    History,
    Zap,
    ArrowUpRight,
    ArrowDownLeft,
    Coins,
    Activity,
    Layers,
    Loader2
} from "lucide-react";

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8081/v1';

export function Wallet() {
    const [wallet, setWallet] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'FIAT' | 'CRYPTO'>('CRYPTO');

    useEffect(() => {
        fetchWallet();
    }, []);

    async function fetchWallet() {
        try {
            const res = await fetchWithAuth(`${API_BASE}/wallet`);
            if (res.ok) {
                const data = await res.json();
                setWallet(data);
            }
        } catch (error) {
            console.error('Failed to fetch wallet:', error);
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return (
            <div className="py-20 flex flex-col items-center justify-center space-y-4 font-mono">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <p className="text-xs font-bold uppercase tracking-widest">Accessing_Vault...</p>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-border pb-6">
                <div>
                    <h1 className="text-4xl font-mono font-black uppercase tracking-tight">Financial_Core</h1>
                    <p className="text-muted-foreground font-mono text-sm uppercase tracking-widest mt-2">Asset management and settlement terminal</p>
                </div>

                <div className="flex p-1 rounded-sm bg-secondary/20 border-2 border-border font-mono">
                    <button
                        onClick={() => setActiveTab('CRYPTO')}
                        className={`px-6 py-2 rounded-sm text-xs font-bold uppercase transition-all ${activeTab === 'CRYPTO'
                            ? 'bg-primary text-primary-foreground shadow-[2px_2px_0] shadow-foreground'
                            : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
                            }`}
                    >
                        TAO_ASSET
                    </button>
                    <button
                        onClick={() => setActiveTab('FIAT')}
                        className={`px-6 py-2 rounded-sm text-xs font-bold uppercase transition-all ${activeTab === 'FIAT'
                            ? 'bg-blue-600 text-white shadow-[2px_2px_0] shadow-foreground'
                            : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
                            }`}
                    >
                        FIAT_CREDITS
                    </button>
                </div>
            </div>

            {activeTab === 'CRYPTO' ? (
                <div className="grid lg:grid-cols-2 gap-8">
                    <div className="card-retro p-8 bg-card flex flex-col items-center text-center space-y-6">
                        <div className="w-16 h-16 bg-primary/10 rounded-sm border-2 border-primary flex items-center justify-center">
                            <Layers className="w-8 h-8 text-primary" />
                        </div>
                        <div>
                            <h2 className="text-xl font-mono font-bold uppercase">AI-Native Settlement</h2>
                            <p className="text-[10px] font-mono text-muted-foreground mt-4 uppercase tracking-[0.2em] max-w-xs mx-auto">
                                PRIMARY CURRENCY FOR AI AGENT RENTALS AND DATA SERVICES.
                            </p>
                        </div>

                        <div className="w-full pt-8 border-t border-border mt-8 space-y-4">
                            <div className="p-6 border-2 border-primary/30 bg-primary/5 rounded-sm text-left">
                                <p className="text-[10px] font-mono font-bold text-primary uppercase tracking-widest mb-2">Core_Balance</p>
                                <p className="text-4xl font-black font-mono tracking-tighter">
                                    {wallet?.balance_tao?.toFixed(4) || '0.0000'} <span className="text-sm opacity-50 uppercase">TAO</span>
                                </p>
                            </div>

                            <div className="p-6 border-2 border-green-500/30 bg-green-500/5 rounded-sm text-left">
                                <p className="text-[10px] font-mono font-bold text-green-500 uppercase tracking-widest mb-2">Pending_Yield</p>
                                <p className="text-4xl font-black font-mono tracking-tighter">
                                    0.000 <span className="text-sm opacity-50 uppercase">TAO</span>
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-6">
                        <div className="card-retro p-8 bg-card border-l-8 border-l-primary">
                            <div className="flex items-center gap-3 mb-6">
                                <Zap className="text-primary w-5 h-5" />
                                <h3 className="text-xs font-mono font-black uppercase tracking-widest">Protocol_Bridge</h3>
                            </div>
                            <p className="text-xs font-mono text-muted-foreground uppercase leading-relaxed">
                                To deposit TAO or SOL, use the web portal for secure wallet signing. Desktop bridge is restricted for security protocols.
                            </p>
                            <a
                                href="https://proxyhubb.com/wallet"
                                target="_blank"
                                rel="noreferrer"
                                className="mt-6 btn-retro btn-retro-outline w-full py-4 text-xs font-bold uppercase"
                            >
                                OPEN_WEB_BRIDGE &rarr;
                            </a>
                        </div>

                        <div className="card-retro p-8 bg-secondary/10 border-dashed border-2">
                            <h3 className="text-xs font-mono font-black uppercase tracking-widest mb-4">Linked_Identities</h3>
                            {wallet?.linked_solana_address ? (
                                <div className="flex items-center gap-3 p-3 bg-background border border-border">
                                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                                    <span className="font-mono text-[10px] font-bold truncate uppercase">{wallet.linked_solana_address}</span>
                                </div>
                            ) : (
                                <p className="text-xs font-mono text-muted-foreground uppercase">No external wallets linked to this operator.</p>
                            )}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="space-y-8">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="md:col-span-2 card-retro p-10 bg-card border-l-8 border-l-blue-600 relative overflow-hidden group">
                            <div className="relative z-10">
                                <div className="flex items-center gap-2 mb-6">
                                    <WalletIcon size={16} className="text-blue-600" />
                                    <span className="text-xs font-mono font-bold uppercase text-muted-foreground">Settlement_Balance</span>
                                </div>
                                <div className="text-7xl font-black font-mono tracking-tighter mb-4 flex items-baseline gap-2">
                                    <span className="text-2xl opacity-40 text-muted-foreground font-bold">₵</span>
                                    {wallet?.balance_ghs?.toFixed(2) || '0.00'}
                                </div>
                                <div className="flex items-center gap-2 text-[10px] font-mono font-bold text-green-500 uppercase tracking-widest">
                                    <Activity size={12} className="animate-pulse" />
                                    SYNCED_WITH_GATEWAY
                                </div>
                            </div>
                            <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
                                <Coins size={150} />
                            </div>
                        </div>

                        <div className="flex flex-col gap-4">
                            <a
                                href="https://proxyhubb.com/wallet"
                                target="_blank"
                                rel="noreferrer"
                                className="flex-1 btn-retro bg-blue-600 text-white flex flex-col items-center justify-center gap-3 hover:translate-x-[4px] hover:translate-y-[4px] hover:shadow-none"
                            >
                                <ArrowDownLeft size={32} />
                                <span className="text-xs font-bold uppercase">INIT_DEPOSIT</span>
                            </a>
                            <a
                                href="https://proxyhubb.com/wallet"
                                target="_blank"
                                rel="noreferrer"
                                className="flex-1 btn-retro btn-retro-outline bg-card flex flex-col items-center justify-center gap-3"
                            >
                                <ArrowUpRight size={32} />
                                <span className="text-xs font-bold uppercase">WITHDRAW_CREDITS</span>
                            </a>
                        </div>
                    </div>

                    <div className="card-retro p-0 bg-card border-2 border-border overflow-hidden">
                        <div className="p-6 border-b border-border flex justify-between items-center bg-secondary/10">
                            <h3 className="font-black font-mono uppercase text-xs flex items-center gap-2">
                                <History size={16} />
                                Transaction_Ledger
                            </h3>
                            <button className="text-[9px] font-mono font-bold text-primary uppercase hover:underline">Download_Logs</button>
                        </div>

                        <div className="overflow-x-auto font-mono">
                            {!wallet?.transactions || wallet.transactions.length === 0 ? (
                                <div className="p-16 text-center">
                                    <History size={48} className="mx-auto text-muted-foreground opacity-10 mb-4" />
                                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Digital_Void: No_Records_Found</p>
                                </div>
                            ) : (
                                <table className="w-full text-left font-mono text-xs">
                                    <thead className="bg-secondary/20 border-b border-border text-muted-foreground font-black">
                                        <tr>
                                            <th className="px-6 py-4 uppercase">Description</th>
                                            <th className="px-6 py-4 uppercase">Amount</th>
                                            <th className="px-6 py-4 uppercase">Status</th>
                                            <th className="px-6 py-4 uppercase">Timestamp</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {wallet.transactions.map((tx: any) => (
                                            <tr key={tx.id} className="hover:bg-accent/30 transition-colors group">
                                                <td className="px-6 py-5">
                                                    <div className="font-bold uppercase group-hover:text-primary transition-colors">{tx.description}</div>
                                                    <div className="text-[9px] text-muted-foreground uppercase font-medium">{tx.type}</div>
                                                </td>
                                                <td className={`px-6 py-5 font-black text-sm tabular-nums ${tx.amount >= 0 ? 'text-primary' : 'text-red-500'}`}>
                                                    {tx.amount >= 0 ? '+' : ''}{tx.amount.toFixed(2)}
                                                </td>
                                                <td className="px-6 py-5">
                                                    <span className={`px-2 py-0.5 border text-[9px] font-bold uppercase ${tx.status === 'success' || tx.status === 'completed'
                                                        ? 'bg-primary/10 border-primary text-primary'
                                                        : tx.status === 'failed'
                                                            ? 'bg-red-500/10 border-red-500 text-red-500'
                                                            : 'bg-yellow-500/10 border-yellow-500 text-yellow-500'
                                                        }`}>
                                                        {tx.status?.toUpperCase() || 'SETTLED'}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-5 text-muted-foreground uppercase font-medium">
                                                    {new Date(tx.created_at).toLocaleString()}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

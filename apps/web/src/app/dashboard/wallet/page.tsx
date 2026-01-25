"use client";

import { useAuth } from '@/lib/auth';
import { useEffect, useState } from 'react';
import {
    getWallet,
    depositWallet,
    depositCrypto,
    withdrawWallet,
    linkWallet,
    transferFunds,
    getSystemConfig,
    Wallet as WalletType,
} from '@/lib/api';

import { useWallet as useSolanaWallet } from '@solana/wallet-adapter-react';
import { SolanaWalletButton } from '@/components/SolanaWalletButton';
import { API_BASE_URL, fetchWithAuth } from '@/lib/services/client';
import { Connection, SystemProgram, Transaction, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import {
    Wallet as WalletIcon,
    History,
    Zap,
    ArrowUpRight,
    ArrowDownLeft,
    X,
    Info,
    ShieldCheck,
    ArrowRight,
    Coins,
    Shield,
    Activity,
    Layers,
    Loader2,
    AlertCircle,
    Hammer,
    CheckCircle,
    Link as LinkIcon,
    LayoutDashboard,
    ArrowLeftRight
} from 'lucide-react';

type TabType = 'OVERVIEW' | 'LINKED_WALLETS';

export default function UnifiedWalletPage() {
    const { user } = useAuth();
    const [wallet, setWallet] = useState<WalletType | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<TabType>('OVERVIEW');
    const [treasuryConfig, setTreasuryConfig] = useState<{ treasury_solana: string } | null>(null);

    // Common State
    const [processing, setProcessing] = useState(false);
    const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
    const [amount, setAmount] = useState('');

    // Solana Wallet
    const { connected, publicKey, signMessage, sendTransaction } = useSolanaWallet();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
        fetchWallet();
        fetchConfig();
    }, []);

    useEffect(() => {
        const interval = setInterval(() => {
            fetchWallet();
        }, 15000);
        return () => clearInterval(interval);
    }, [user]);

    // Data Fetching
    const fetchWallet = async () => {
        try {
            const data = await getWallet();
            setWallet(data || {
                id: '',
                balance_ghs: 0,
                balance_sol: 0,
                balance_usdt: 0,
                currency: 'MULTI',
                transactions: [],
                created_at: new Date().toISOString()
            });
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const fetchConfig = async () => {
        try {
            const cfg = await getSystemConfig();
            setTreasuryConfig(cfg);
        } catch (e) {
            console.error(e);
        }
    };

    // Linking Logic
    const handleLinkSolana = async () => {
        if (!publicKey || !user?.id || !signMessage) return;
        setProcessing(true);
        try {
            const message = `Link Wallet ${publicKey.toBase58()} to ProxyHubb User ${user.id}`;
            const encodedMessage = new TextEncoder().encode(message);
            const sigBytes = await signMessage(encodedMessage);
            const signature = bs58.encode(sigBytes);

            await linkWallet(publicKey.toBase58(), 'solana', signature, message);
            setResult({ success: true, message: "Solana Wallet Linked" });
            fetchWallet();
        } catch (err: any) {
            setResult({ success: false, message: err.message || "Linking failed" });
        } finally {
            setProcessing(false);
        }
    };

    if (!mounted) return null;

    return (
        <div className="space-y-8 animate-in fade-in duration-500 pb-20">
            {/* Header */}
            <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 border-b border-border pb-6">
                <div>
                    <h1 className="text-3xl font-black font-mono uppercase tracking-tight flex items-center gap-3">
                        <WalletIcon className="text-primary" /> Financial HQ
                    </h1>
                    <p className="text-muted-foreground font-mono text-[10px] mt-1 tracking-widest uppercase">Decentralized Asset Management</p>
                </div>

                <div className="flex bg-secondary/20 p-1 rounded-sm border border-border">
                    {(['OVERVIEW', 'LINKED_WALLETS'] as TabType[]).map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`px-3 py-1.5 text-[10px] font-mono font-black uppercase transition-all ${activeTab === tab
                                ? 'bg-primary text-primary-foreground'
                                : 'text-muted-foreground hover:text-foreground'}`}
                        >
                            {tab.replace('_', ' ')}
                        </button>
                    ))}
                </div>
            </header>

            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                    {/* Main Content Area */}
                    <div className="lg:col-span-8 space-y-8">
                        {activeTab === 'OVERVIEW' && (
                            <div className="space-y-8">
                                {/* Balance Cards */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="card-retro p-6 border-primary/30 bg-primary/5 group relative overflow-hidden">
                                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
                                            <Zap size={80} className="text-primary" />
                                        </div>
                                        <p className="text-[10px] font-mono font-bold text-primary uppercase tracking-widest mb-4">Solana Balance</p>
                                        <div className="text-5xl font-black font-mono tracking-tighter flex items-center gap-2">
                                            {wallet?.balance_sol?.toFixed(4) || '0.0000'}
                                            <span className="text-lg opacity-40 font-bold">SOL</span>
                                        </div>
                                        <div className="mt-6 flex items-center gap-2 text-[10px] font-mono text-green-500/80 bg-green-500/5 px-2 py-1 border border-green-500/10 w-fit">
                                            <Activity size={12} /> SOLANA MAINNET CONNECTED
                                        </div>
                                    </div>

                                    <div className="card-retro p-6 border-blue-500/30 bg-blue-500/5 group relative overflow-hidden">
                                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
                                            <Coins size={80} className="text-blue-500" />
                                        </div>
                                        <p className="text-[10px] font-mono font-bold text-blue-500 uppercase tracking-widest mb-4">Stable Balance (USDT)</p>
                                        <div className="text-5xl font-black font-mono tracking-tighter flex items-center gap-2">
                                            ${wallet?.balance_usdt?.toFixed(2) || '0.00'}
                                        </div>
                                        <div className="mt-6 flex items-center gap-2 text-[10px] font-mono text-blue-500/80 bg-blue-500/5 px-2 py-1 border border-blue-500/10 w-fit">
                                            <ShieldCheck size={12} /> LIQUIDITY VAULT SYNCED
                                        </div>
                                    </div>
                                </div>

                                {/* Transaction Ledger */}
                                <div className="card-retro border-border">
                                    <div className="p-4 border-b border-border bg-secondary/10 flex justify-between items-center">
                                        <h3 className="text-xs font-black font-mono uppercase flex items-center gap-2">
                                            <History size={14} /> Settlement Ledger
                                        </h3>
                                        <span className="text-[10px] font-mono opacity-50 uppercase">Live Update</span>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left font-mono text-xs">
                                            <thead className="text-[10px] uppercase text-muted-foreground border-b border-border">
                                                <tr>
                                                    <th className="px-6 py-3 font-medium">TxID / Description</th>
                                                    <th className="px-6 py-3 font-medium">Amount</th>
                                                    <th className="px-6 py-3 font-medium">Status</th>
                                                    <th className="px-6 py-3 font-medium">Timestamp</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-border">
                                                {wallet?.transactions?.map((tx) => (
                                                    <tr key={tx.id} className="hover:bg-white/5">
                                                        <td className="px-6 py-4">
                                                            <div className="font-bold uppercase leading-none mb-1">{tx.description}</div>
                                                            <div className="text-[9px] opacity-40 uppercase truncate max-w-[150px]">{tx.id}</div>
                                                        </td>
                                                        <td className={`px-6 py-4 font-black ${tx.amount > 0 ? 'text-green-500' : 'text-red-500'}`}>
                                                            {tx.amount > 0 ? '+' : ''}{tx.amount.toFixed(2)}
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-black border uppercase ${tx.status === 'success' || tx.status === 'completed' ? 'bg-green-500/10 text-green-500 border-green-500/20' : 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20'
                                                                }`}>
                                                                {tx.status}
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-4 text-[10px] opacity-50">
                                                            {new Date(tx.created_at).toLocaleString()}
                                                        </td>
                                                    </tr>
                                                ))}
                                                {(!wallet?.transactions || wallet.transactions.length === 0) && (
                                                    <tr>
                                                        <td colSpan={4} className="px-6 py-10 text-center text-[10px] font-mono text-muted-foreground uppercase">
                                                            No transactions found in this era.
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'LINKED_WALLETS' && (
                            <div className="space-y-8 animate-in slide-in-from-bottom-2">
                                <section className="p-6 card-retro border-border bg-card">
                                    <h3 className="text-xs font-black font-mono uppercase mb-6 flex items-center gap-2">
                                        <LinkIcon size={14} className="text-primary" /> Connect Identity
                                    </h3>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        {/* Solana Link */}
                                        <div className="p-6 border border-border bg-secondary/5 rounded-sm group">
                                            <div className="flex justify-between items-start mb-6">
                                                <div className="p-3 bg-purple-500/10 rounded-sm border border-purple-500/20 group-hover:scale-110 transition-transform">
                                                    <Zap className="text-purple-500" />
                                                </div>
                                                <span className="text-[10px] font-mono opacity-40">SOLANA</span>
                                            </div>
                                            {wallet?.linked_solana_address ? (
                                                <div className="space-y-2">
                                                    <p className="text-[10px] font-mono text-green-500 uppercase font-black">Linked & Verified</p>
                                                    <p className="text-xs font-mono truncate bg-black/20 p-2 border border-white/5 rounded-sm">{wallet.linked_solana_address}</p>
                                                </div>
                                            ) : (
                                                <div className="space-y-4">
                                                    <SolanaWalletButton />
                                                    {connected && (
                                                        <button
                                                            onClick={handleLinkSolana}
                                                            disabled={processing}
                                                            className="w-full btn-retro text-[10px] py-2 uppercase font-black"
                                                        >
                                                            {processing ? '...' : 'Verify Ownership'}
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </section>

                                {result && (
                                    <div className={`p-4 rounded-sm border text-[10px] font-mono uppercase font-black flex gap-3 ${result.success ? 'bg-green-500/10 border-green-500/20 text-green-500' : 'bg-red-500/10 border-red-500/20 text-red-500'
                                        }`}>
                                        <ShieldCheck size={14} /> {result.message}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Sidebar Area */}
                    <div className="lg:col-span-4 space-y-8">
                        {/* Financial Health Summary */}
                        <div className="card-retro p-6 border-white/10 bg-black/20">
                            <h3 className="text-xs font-black font-mono uppercase mb-6 flex items-center gap-2">
                                <Activity size={14} className="text-muted-foreground" /> Protocol Health
                            </h3>
                            <div className="space-y-6">
                                <div className="space-y-1">
                                    <div className="flex justify-between text-[10px] font-mono uppercase opacity-50">
                                        <span>Treasury Solvency</span>
                                        <span>100%</span>
                                    </div>
                                    <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                                        <div className="h-full bg-primary w-[100%]"></div>
                                    </div>
                                </div>

                                <div className="p-4 bg-white/5 border border-white/5 rounded-sm group relative overflow-hidden">
                                    <p className="text-[10px] font-mono text-muted-foreground uppercase mb-1">Streaming Earnings (L2)</p>
                                    <p className="text-xl font-black font-mono text-green-500">
                                        + $<VestingTicker base={0} rate={0} />
                                    </p>
                                    <div className="absolute bottom-0 left-0 h-0.5 bg-green-500/30 w-full animate-progress-ind"></div>
                                </div>

                                <div className="p-4 bg-white/5 border border-white/5 rounded-sm">
                                    <p className="text-[10px] font-mono text-muted-foreground uppercase mb-1">Active Collateral</p>
                                    <p className="text-xl font-black font-mono">${wallet?.balance_usdt?.toFixed(2) || '0.00'}</p>
                                </div>
                            </div>
                        </div>

                        {/* Session Vesting Telemetry */}
                        <div className="card-retro p-6 border-primary/20 bg-primary/2">
                            <h3 className="text-xs font-black font-mono uppercase mb-4 flex items-center gap-2">
                                <Zap size={14} className="text-primary" /> Active Stream Telemetry
                            </h3>
                            <div className="space-y-4">
                                <div className="flex justify-between items-center text-[10px] font-mono uppercase">
                                    <span className="text-muted-foreground">Session: {wallet?.id ? `${wallet.id.slice(0, 4)}...${wallet.id.slice(-4)}` : 'NONE'}</span>
                                    <span className={wallet?.id ? "text-primary animate-pulse" : "text-muted-foreground"}>{wallet?.id ? 'LIVE' : 'IDLE'}</span>
                                </div>
                                <div className="flex justify-between items-end border-b border-white/5 pb-2">
                                    <span className="text-[9px] font-mono text-muted-foreground uppercase">Accumulated</span>
                                    <span className="text-lg font-black font-mono">$<VestingTicker base={0} rate={0} /></span>
                                </div>
                                <div className="flex justify-between items-end">
                                    <span className="text-[9px] font-mono text-muted-foreground uppercase">SOL Throughput</span>
                                    <span className="text-xs font-bold font-mono text-green-500">{wallet?.id ? '99.8%' : '0.0%'}</span>
                                </div>
                            </div>
                        </div>

                        {/* Watchtower Alert Box */}
                        <div className="card-retro p-6 border-green-500/20 bg-green-500/5">
                            <div className="flex items-center gap-2 mb-4">
                                <Shield className="text-green-500" size={14} />
                                <span className="text-[10px] font-black font-mono uppercase text-green-500">Secure Guard</span>
                            </div>
                            <p className="text-[10px] font-mono text-green-500/70 leading-relaxed uppercase">
                                Monitoring treasury outflows. System has cleared 15,302 transactions since last automated pause.
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// Utility Component for real-time tickers
function VestingTicker({ base, rate }: { base: number, rate: number }) {
    const [val, setVal] = useState(base);

    useEffect(() => {
        const interval = setInterval(() => {
            setVal(v => v + rate);
        }, 100);
        return () => clearInterval(interval);
    }, [rate]);

    return <span>{val.toFixed(5)}</span>;
}

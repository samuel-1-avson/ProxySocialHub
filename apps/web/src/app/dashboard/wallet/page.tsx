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
    ArrowLeftRight,
    ChevronRight,
    TrendingUp,
    Lock
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { GlassCard } from '@/components/ui/glass-card';

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

    const containerVariants = {
        hidden: { opacity: 0 },
        show: {
            opacity: 1,
            transition: { staggerChildren: 0.1 }
        }
    };

    const itemVariants = {
        hidden: { opacity: 0, y: 20 },
        show: { opacity: 1, y: 0 }
    };

    return (
        <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="space-y-8 pb-20"
        >
            {/* Header */}
            <motion.header variants={itemVariants} className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 border-b border-white/5 pb-8">
                <div>
                    <div className="flex items-center gap-2 text-primary font-mono text-[10px] font-black uppercase tracking-[0.3em] mb-1">
                        <Lock size={12} className="animate-pulse" /> Secure Financial Sector
                    </div>
                    <h1 className="text-4xl font-black font-mono uppercase tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-primary to-emerald-400 flex items-center gap-3">
                        <WalletIcon size={32} className="text-primary" /> Financial HQ
                    </h1>
                </div>

                <div className="flex bg-white/5 p-1.5 rounded-xl border border-white/10 backdrop-blur-md">
                    {(['OVERVIEW', 'LINKED_WALLETS'] as TabType[]).map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`px-4 py-2 text-[10px] font-mono font-black uppercase transition-all rounded-lg ${activeTab === tab
                                ? 'bg-primary text-primary-foreground shadow-lg'
                                : 'text-muted-foreground hover:text-foreground hover:bg-white/5'}`}
                        >
                            {tab.replace('_', ' ')}
                        </button>
                    ))}
                </div>
            </motion.header>

            {loading ? (
                <div className="flex flex-col items-center justify-center py-32 space-y-4">
                    <Loader2 className="w-10 h-10 animate-spin text-primary" />
                    <p className="font-mono text-[10px] font-black uppercase tracking-widest text-muted-foreground animate-pulse">Synchronizing Ledger...</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                    {/* Main Content Area */}
                    <div className="lg:col-span-8 space-y-8">
                        <AnimatePresence mode="wait">
                            {activeTab === 'OVERVIEW' && (
                                <motion.div
                                    key="overview"
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: 20 }}
                                    className="space-y-8"
                                >
                                    {/* Balance Cards */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <motion.div
                                            whileHover={{ y: -5 }}
                                            className="glass-card p-8 border-primary/20 bg-primary/5 group relative overflow-hidden"
                                        >
                                            <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:scale-110 group-hover:opacity-10 transition-all duration-500">
                                                <Zap size={120} className="text-primary" />
                                            </div>
                                            <div className="flex justify-between items-center mb-6">
                                                <p className="text-[10px] font-mono font-black text-primary uppercase tracking-[0.2em]">Solana Native Access</p>
                                                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center border border-primary/20">
                                                    <TrendingUp size={14} className="text-primary" />
                                                </div>
                                            </div>
                                            <div className="text-5xl font-black font-mono tracking-tighter flex items-center gap-3">
                                                {wallet?.balance_sol?.toFixed(4) || '0.0000'}
                                                <span className="text-xl opacity-40 font-black">SOL</span>
                                            </div>
                                            <div className="mt-8 flex items-center gap-2 text-[9px] font-mono font-black text-emerald-500/80 bg-emerald-500/5 px-3 py-1.5 rounded-full border border-emerald-500/10 w-fit uppercase tracking-widest">
                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                                Solana Mainnet: Synced
                                            </div>
                                        </motion.div>

                                        <motion.div
                                            whileHover={{ y: -5 }}
                                            className="glass-card p-8 border-blue-500/20 bg-blue-500/5 group relative overflow-hidden"
                                        >
                                            <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:scale-110 group-hover:opacity-10 transition-all duration-500">
                                                <Coins size={120} className="text-blue-500" />
                                            </div>
                                            <div className="flex justify-between items-center mb-6">
                                                <p className="text-[10px] font-mono font-black text-blue-500 uppercase tracking-[0.2em]">Stable Reserve (USDT)</p>
                                                <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                                                    <ShieldCheck size={14} className="text-blue-500" />
                                                </div>
                                            </div>
                                            <div className="text-5xl font-black font-mono tracking-tighter flex items-center gap-3">
                                                <span className="text-xl opacity-40 font-black">$</span>
                                                {wallet?.balance_usdt?.toFixed(2) || '0.00'}
                                            </div>
                                            <div className="mt-8 flex items-center gap-2 text-[9px] font-mono font-black text-blue-500/80 bg-blue-500/5 px-3 py-1.5 rounded-full border border-blue-500/10 w-fit uppercase tracking-widest">
                                                <Activity size={12} className="text-blue-500" />
                                                Liquidity Node: Active
                                            </div>
                                        </motion.div>
                                    </div>

                                    {/* Transaction Ledger */}
                                    <div className="glass-card p-0 border-white/5 bg-white/2 overflow-hidden">
                                        <div className="p-6 border-b border-white/5 bg-white/5 flex justify-between items-center">
                                            <h3 className="text-xs font-black font-mono uppercase flex items-center gap-2 tracking-widest">
                                                <History size={16} className="text-primary" /> Settlement Ledger
                                            </h3>
                                            <div className="flex items-center gap-2 px-3 py-1 bg-primary/10 rounded-full border border-primary/20">
                                                <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></div>
                                                <span className="text-[9px] font-black font-mono text-primary uppercase tracking-widest">Live Flow</span>
                                            </div>
                                        </div>
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-left font-mono text-xs">
                                                <thead className="text-[9px] font-black uppercase text-muted-foreground/50 border-b border-white/5 bg-white/2">
                                                    <tr>
                                                        <th className="px-8 py-4 tracking-widest">Description / Identifier</th>
                                                        <th className="px-8 py-4 tracking-widest">Amount Delta</th>
                                                        <th className="px-8 py-4 tracking-widest text-center">Protocol Status</th>
                                                        <th className="px-8 py-4 tracking-widest text-right">Synchronization</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-white/2">
                                                    {wallet?.transactions?.map((tx) => (
                                                        <motion.tr
                                                            key={tx.id}
                                                            initial={{ opacity: 0 }}
                                                            animate={{ opacity: 1 }}
                                                            className="hover:bg-white/5 transition-colors group"
                                                        >
                                                            <td className="px-8 py-5">
                                                                <div className="font-black uppercase text-[11px] group-hover:text-primary transition-colors">{tx.description}</div>
                                                                <div className="text-[9px] opacity-30 uppercase font-bold tracking-tighter mt-1">{tx.id}</div>
                                                            </td>
                                                            <td className={`px-8 py-5 font-black text-base tracking-tighter ${tx.amount > 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                                {tx.amount > 0 ? '+' : ''}{tx.amount.toFixed(2)}
                                                            </td>
                                                            <td className="px-8 py-5 text-center">
                                                                <span className={`px-3 py-1 rounded-full text-[9px] font-black border uppercase tracking-widest inline-block ${tx.status === 'success' || tx.status === 'completed' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.1)]' : 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                                                                    }`}>
                                                                    {tx.status}
                                                                </span>
                                                            </td>
                                                            <td className="px-8 py-5 text-right">
                                                                <div className="text-[10px] font-black opacity-40 uppercase">{new Date(tx.created_at).toLocaleDateString()}</div>
                                                                <div className="text-[9px] opacity-20 uppercase font-black">{new Date(tx.created_at).toLocaleTimeString()}</div>
                                                            </td>
                                                        </motion.tr>
                                                    ))}
                                                    {(!wallet?.transactions || wallet.transactions.length === 0) && (
                                                        <tr>
                                                            <td colSpan={4} className="px-8 py-16 text-center text-[10px] font-mono text-muted-foreground/30 uppercase tracking-[0.5em] font-black italic">
                                                                Ledger sectors empty. No activity detected.
                                                            </td>
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </motion.div>
                            )}

                            {activeTab === 'LINKED_WALLETS' && (
                                <motion.div
                                    key="linked"
                                    initial={{ opacity: 0, scale: 0.98 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.98 }}
                                    className="space-y-8"
                                >
                                    <GlassCard className="!p-8 bg-white/2 border-white/5 shadow-2xl">
                                        <h3 className="text-xs font-black font-mono uppercase mb-8 flex items-center gap-3 tracking-[0.2em]">
                                            <LinkIcon size={18} className="text-primary animate-pulse" /> Cryptographic Identity Mapping
                                        </h3>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                            {/* Solana Link */}
                                            <div className="p-8 glass-card border-white/5 bg-white/5 rounded-2xl group relative overflow-hidden">
                                                <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                                                    <Zap size={64} className="text-purple-500" />
                                                </div>
                                                <div className="flex justify-between items-start mb-8">
                                                    <div className="p-4 bg-purple-500/10 rounded-xl border border-purple-500/20 group-hover:scale-110 transition-transform shadow-lg">
                                                        <Zap className="text-purple-500" />
                                                    </div>
                                                    <span className="text-[10px] font-black font-mono opacity-20 uppercase tracking-widest">Solana Network</span>
                                                </div>
                                                {wallet?.linked_solana_address ? (
                                                    <div className="space-y-4">
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,1)]"></div>
                                                            <p className="text-[10px] font-black font-mono text-emerald-500 uppercase tracking-widest">Identity Verified</p>
                                                        </div>
                                                        <div className="text-[11px] font-mono font-black break-all bg-black/40 p-4 border border-white/5 rounded-xl shadow-inner text-primary/80">
                                                            {wallet.linked_solana_address}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="space-y-6">
                                                        <SolanaWalletButton />
                                                        {connected && (
                                                            <motion.button
                                                                whileHover={{ scale: 1.02 }}
                                                                whileTap={{ scale: 0.98 }}
                                                                onClick={handleLinkSolana}
                                                                disabled={processing}
                                                                className="w-full btn-retro !p-4 glass-card border-primary/40 hover:border-primary text-[10px] uppercase font-black tracking-widest shadow-xl flex items-center justify-center gap-2"
                                                            >
                                                                {processing ? <Loader2 size={14} className="animate-spin" /> : <ChevronRight size={14} />}
                                                                {processing ? 'Signing Payload...' : 'Verify Cryptographic Ownership'}
                                                            </motion.button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </GlassCard>

                                    {result && (
                                        <motion.div
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            className={`p-5 rounded-2xl border text-[10px] font-mono uppercase font-black flex items-center gap-4 ${result.success ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.1)]' : 'bg-rose-500/10 border-rose-500/20 text-rose-500 shadow-[0_0_20px_rgba(244,63,94,0.1)]'
                                                }`}>
                                            <ShieldCheck size={18} /> {result.message}
                                        </motion.div>
                                    )}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    {/* Sidebar Area */}
                    <motion.div variants={itemVariants} className="lg:col-span-4 space-y-8">
                        {/* Financial Health Summary */}
                        <div className="glass-card p-8 border-white/10 bg-white/2 relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 -mr-16 -mt-16 rounded-full blur-3xl"></div>
                            <h3 className="text-xs font-black font-mono uppercase mb-8 flex items-center gap-3 tracking-widest relative z-10">
                                <Activity size={16} className="text-primary/70" /> System Solvency
                            </h3>
                            <div className="space-y-8 relative z-10">
                                <div className="space-y-2">
                                    <div className="flex justify-between text-[10px] font-black font-mono uppercase tracking-[0.2em] opacity-40">
                                        <span>Treasury Liquidity</span>
                                        <span className="text-primary">100.00%</span>
                                    </div>
                                    <div className="h-2 bg-white/5 rounded-full overflow-hidden border border-white/5">
                                        <motion.div
                                            initial={{ width: 0 }}
                                            animate={{ width: "100%" }}
                                            transition={{ duration: 1.5 }}
                                            className="h-full bg-gradient-to-r from-primary to-emerald-400"
                                        />
                                    </div>
                                </div>

                                <div className="p-6 glass-card bg-white/5 border-white/10 rounded-2xl group transition-all hover:bg-white/10">
                                    <p className="text-[10px] font-black font-mono text-muted-foreground uppercase mb-2 tracking-widest opacity-50">Estimated ROI (L2 Streaming)</p>
                                    <div className="text-2xl font-black font-mono text-emerald-500 flex items-baseline gap-1">
                                        + $0.00000
                                    </div>
                                    <div className="mt-4 h-0.5 bg-emerald-500/20 w-full overflow-hidden rounded-full">
                                        <div className="h-full w-full bg-emerald-500/10" />
                                    </div>
                                </div>

                                <div className="p-6 glass-card bg-white/5 border-white/10 rounded-2xl">
                                    <p className="text-[10px] font-black font-mono text-muted-foreground uppercase mb-2 tracking-widest opacity-50">Active Collateral Index</p>
                                    <p className="text-2xl font-black font-mono text-foreground tracking-tighter">${wallet?.balance_usdt?.toFixed(2) || '0.00'}</p>
                                </div>
                            </div>
                        </div>

                        {/* Session Vesting Telemetry */}
                        <div className="glass-card p-8 border-primary/20 bg-primary/2 overflow-hidden relative">
                            <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-primary/10 rounded-full blur-3xl"></div>
                            <h3 className="text-xs font-black font-mono uppercase mb-6 flex items-center gap-3 tracking-widest relative z-10">
                                <Zap size={16} className="text-primary" /> Network Pulse
                            </h3>
                            <div className="space-y-6 relative z-10">
                                <div className="flex justify-between items-center text-[10px] font-black font-mono uppercase tracking-widest">
                                    <span className="text-muted-foreground/60 italic font-medium">Session Fragment</span>
                                    <span className="bg-secondary/50 px-2 py-1 rounded text-primary border border-primary/10">
                                        {wallet?.id ? `${wallet.id.slice(0, 4)}...${wallet.id.slice(-4)}` : 'IDLE_INIT'}
                                    </span>
                                </div>
                                <div className="flex justify-between items-end border-b border-white/5 pb-4">
                                    <span className="text-[10px] font-black font-mono text-muted-foreground uppercase tracking-widest opacity-40">Cumulative Flow</span>
                                    <span className="text-2xl font-black font-mono tracking-tighter">$0.00</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <div className="flex items-center gap-2">
                                        <div className={`w-2 h-2 rounded-full ${wallet?.id ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground opacity-30'}`}></div>
                                        <span className="text-[10px] font-black font-mono text-muted-foreground uppercase tracking-widest opacity-40">Throughput</span>
                                    </div>
                                    <span className="text-xs font-black font-mono text-emerald-500">{wallet?.id ? '99.98%' : 'OFFLINE'}</span>
                                </div>
                            </div>
                        </div>

                        {/* Secure Guard Alert Box */}
                        <motion.div
                            whileHover={{ scale: 1.02 }}
                            className="glass-card p-6 border-emerald-500/20 bg-emerald-500/5 cursor-default"
                        >
                            <div className="flex items-center gap-3 mb-4">
                                <Shield className="text-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]" size={18} />
                                <span className="text-[10px] font-black font-mono uppercase text-emerald-500 tracking-[0.2em]">Sentinel Protocol</span>
                            </div>
                            <p className="text-[10px] font-mono text-emerald-500/70 leading-relaxed uppercase font-bold">
                                Monitoring treasury audit trails. Multi-signature consensus active. System synchronized.
                            </p>
                        </motion.div>
                    </motion.div>
                </div>
            )}
        </motion.div>
    );
}

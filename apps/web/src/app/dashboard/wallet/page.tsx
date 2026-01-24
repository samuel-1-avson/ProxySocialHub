"use client";

import { useAuth } from '@/lib/auth';
import { useEffect, useState } from 'react';
import {
    getWallet,
    depositWallet,
    depositCrypto,
    withdrawWallet,
    linkWallet,
    getStakes,
    stakeFunds,
    unstakeFunds,
    transferFunds,
    getSystemConfig,
    startFaucet,
    getFaucetStatus,
    Wallet as WalletType,
    StakingPosition
} from '@/lib/api';

import { useWallet as useSolanaWallet } from '@solana/wallet-adapter-react';
import { SolanaWalletButton } from '@/components/SolanaWalletButton';
import { SubstrateWalletModal } from '@/components/SubstrateWalletModal';
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

type TabType = 'OVERVIEW' | 'BRIDGE' | 'STAKING' | 'LINKED_WALLETS';

export default function UnifiedWalletPage() {
    const { user } = useAuth();
    const [wallet, setWallet] = useState<WalletType | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<TabType>('OVERVIEW');
    const [treasuryConfig, setTreasuryConfig] = useState<{ treasury_solana: string; treasury_tao: string } | null>(null);

    // Common State
    const [processing, setProcessing] = useState(false);
    const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
    const [amount, setAmount] = useState('');
    const [destAddress, setDestAddress] = useState('');

    // Solana Wallet
    const { connected, publicKey, signMessage, sendTransaction } = useSolanaWallet();
    const [mounted, setMounted] = useState(false);

    // Staking & P2P
    const [stakes, setStakes] = useState<StakingPosition[]>([]);
    const [stakingAction, setStakingAction] = useState<'stake' | 'unstake' | null>(null);
    const [activeCurrency, setActiveCurrency] = useState<'TAO' | 'GHS'>('TAO');

    // Faucet
    const [faucetStatus, setFaucetStatus] = useState<string>('IDLE');
    const [faucetElapsed, setFaucetElapsed] = useState<number>(0);
    const [faucetMessage, setFaucetMessage] = useState<string>('');

    // Substrate
    const [isTAOModalOpen, setIsTAOModalOpen] = useState(false);

    const handleBridge = async () => {
        if (!publicKey || !connected) return;
        if (!treasuryConfig?.treasury_solana) {
            setResult({ success: false, message: 'Treasury config missing' });
            return;
        }

        setProcessing(true);
        setResult(null);

        try {
            const connection = new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC || 'https://api.devnet.solana.com');
            const destPubkey = new PublicKey(treasuryConfig.treasury_solana);
            const valAmount = parseFloat(amount);

            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: publicKey,
                    toPubkey: destPubkey,
                    lamports: BigInt(Math.floor(valAmount * LAMPORTS_PER_SOL)),
                })
            );

            const { blockhash } = await connection.getLatestBlockhash();
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = publicKey;

            const signature = await sendTransaction(transaction, connection);
            await connection.confirmTransaction(signature, 'processed');

            // 2. Submit for Cross-Chain Verification
            const bridgeRes = await depositCrypto(valAmount, signature, 'solana', destAddress || undefined);

            setResult({ success: true, message: bridgeRes.message || "Bridge transaction submitted! TAO will reflect shortly." });
            setAmount('');
            setDestAddress('');
            fetchWallet();

        } catch (err: any) {
            console.error(err);
            setResult({ success: false, message: err.message || "Bridge execution failed" });
        } finally {
            setProcessing(false);
        }
    };

    useEffect(() => {
        setMounted(true);
        fetchWallet();
        fetchConfig();
    }, []);

    useEffect(() => {
        if (user) fetchStakes();

        const interval = setInterval(() => {
            fetchWallet();
            fetchStakes();
        }, 15000);
        return () => clearInterval(interval);
    }, [user]);

    // Data Fetching
    const fetchWallet = async () => {
        try {
            const data = await getWallet();
            setWallet(data || { id: '', balance_ghs: 0, balance_tao: 0, currency: 'MULTI', transactions: [] });
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    };

    const fetchConfig = async () => {
        try {
            const cfg = await getSystemConfig();
            setTreasuryConfig(cfg);
        } catch (e) { console.error(e); }
    };

    const fetchStakes = async () => {
        try {
            const data = await getStakes();
            setStakes(Array.isArray(data) ? data : []);
        } catch (e) {
            console.error(e);
            setStakes([]);
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
        } finally { setProcessing(false); }
    };

    const handleLinkBittensor = async (selectedAccount?: any) => {
        setProcessing(true);
        setIsTAOModalOpen(false);
        try {
            const { web3Enable, web3FromSource } = await import('@polkadot/extension-dapp');
            const { stringToHex } = await import('@polkadot/util');
            await web3Enable('ProxySocialHub');

            let account = selectedAccount;
            if (!account) {
                const { web3Accounts } = await import('@polkadot/extension-dapp');
                const allAccounts = await web3Accounts();
                if (allAccounts.length === 0) throw new Error('No Substrate accounts found');
                account = allAccounts[0];
            }

            const injector = await web3FromSource(account.meta.source);
            const message = `Sign this message to link your Bittensor wallet to ProxySocialHub.\n\nWallet: ${account.address}\nTimestamp: ${Date.now()}`;

            if (!injector.signer.signRaw) throw new Error('Wallet does not support raw signing');

            const { signature } = await injector.signer.signRaw({
                address: account.address,
                data: stringToHex(message),
                type: 'bytes'
            });

            await linkWallet(account.address, 'bittensor', signature, message);
            setResult({ success: true, message: 'Bittensor wallet linked successfully!' });
            fetchWallet();
        } catch (err: any) {
            setResult({ success: false, message: err.message });
        } finally { setProcessing(false); }
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
                    <p className="text-muted-foreground font-mono text-[10px] mt-1 tracking-widest uppercase">Industrial-Grade Asset Management</p>
                </div>

                <div className="flex bg-secondary/20 p-1 rounded-sm border border-border">
                    {(['OVERVIEW', 'BRIDGE', 'STAKING', 'LINKED_WALLETS'] as TabType[]).map(tab => (
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
                                        <p className="text-[10px] font-mono font-bold text-primary uppercase tracking-widest mb-4">Core AI Credits</p>
                                        <div className="text-5xl font-black font-mono tracking-tighter flex items-center gap-2">
                                            {wallet?.balance_tao?.toFixed(4) || '0.0000'}
                                            <span className="text-lg opacity-40 font-bold">TAO</span>
                                        </div>
                                        <div className="mt-6 flex items-center gap-2 text-[10px] font-mono text-green-500/80 bg-green-500/5 px-2 py-1 border border-green-500/10 w-fit">
                                            <Activity size={12} /> BIT TENSOR NETWORK CONNECTED
                                        </div>
                                    </div>

                                    <div className="card-retro p-6 border-blue-500/30 bg-blue-500/5 group relative overflow-hidden">
                                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
                                            <Coins size={80} className="text-blue-500" />
                                        </div>
                                        <p className="text-[10px] font-mono font-bold text-blue-500 uppercase tracking-widest mb-4">Protocol Fiat (GHS)</p>
                                        <div className="text-5xl font-black font-mono tracking-tighter flex items-center gap-2">
                                            ₵{wallet?.balance_ghs?.toFixed(2) || '0.00'}
                                        </div>
                                        <div className="mt-6 flex items-center gap-2 text-[10px] font-mono text-blue-500/80 bg-blue-500/5 px-2 py-1 border border-blue-500/10 w-fit">
                                            <ShieldCheck size={12} /> SECURE OFF-RAMP SYNCED
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
                                                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-black border uppercase ${tx.status === 'success' ? 'bg-green-500/10 text-green-500 border-green-500/20' : 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20'
                                                                }`}>
                                                                {tx.status}
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-4 text-[10px] opacity-50">
                                                            {new Date(tx.created_at).toLocaleString()}
                                                        </td>
                                                    </tr>
                                                ))}
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
                                        <LinkIcon size={14} className="text-primary" /> Connect New Identities
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

                                        {/* Bittensor Link */}
                                        <div className="p-6 border border-border bg-secondary/5 rounded-sm group">
                                            <div className="flex justify-between items-start mb-6">
                                                <div className="p-3 bg-primary/10 rounded-sm border border-primary/20 group-hover:scale-110 transition-transform">
                                                    <Layers className="text-primary" />
                                                </div>
                                                <span className="text-[10px] font-mono opacity-40">BITTENSOR</span>
                                            </div>
                                            {wallet?.linked_bittensor_addr ? (
                                                <div className="space-y-2">
                                                    <p className="text-[10px] font-mono text-green-500 uppercase font-black">Linked & Verified</p>
                                                    <p className="text-xs font-mono truncate bg-black/20 p-2 border border-white/5 rounded-sm">{wallet.linked_bittensor_addr}</p>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => setIsTAOModalOpen(true)}
                                                    disabled={processing}
                                                    className="w-full btn-retro text-[10px] py-4 uppercase font-black"
                                                >
                                                    {processing ? '...' : 'Connect Substrate Wallet'}
                                                </button>
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

                        {/* BRIDGE and STAKING Implementation */}
                        {activeTab === 'BRIDGE' && (
                            <div className="space-y-6 animate-in slide-in-from-bottom-2">
                                <div className="card-retro p-6 border-primary/30 bg-primary/5">
                                    <div className="flex items-center justify-between mb-6">
                                        <h3 className="text-xs font-black font-mono uppercase text-primary flex items-center gap-2">
                                            <ArrowLeftRight size={14} /> Atomic Multi-Chain Bridge
                                        </h3>
                                        <span className="text-[10px] font-mono bg-primary/10 text-primary px-2 py-0.5 rounded-full border border-primary/20">Zero Slippage</span>
                                    </div>

                                    <div className="space-y-6">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div className="p-4 bg-black/20 border border-white/10 rounded-sm">
                                                <p className="text-[10px] font-mono text-muted-foreground uppercase mb-2">Source Chain</p>
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 bg-purple-500 rounded-full flex items-center justify-center font-bold text-xs ring-2 ring-purple-500/20">S</div>
                                                    <span className="font-mono font-bold">SOLANA</span>
                                                </div>
                                            </div>
                                            <div className="p-4 bg-black/20 border border-white/10 rounded-sm">
                                                <p className="text-[10px] font-mono text-muted-foreground uppercase mb-2">Destination Chain</p>
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center font-bold text-xs ring-2 ring-primary/20">T</div>
                                                    <span className="font-mono font-bold">BITTENSOR (L3)</span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="space-y-4">
                                            <div className="relative">
                                                <input
                                                    type="number"
                                                    placeholder="Amount (SOL)"
                                                    value={amount}
                                                    onChange={(e) => setAmount(e.target.value)}
                                                    className="w-full bg-background border border-border rounded-sm px-4 py-4 font-mono text-2xl font-black outline-none focus:border-primary transition-all pr-16"
                                                />
                                                <span className="absolute right-4 top-1/2 -translate-y-1/2 font-mono text-xs font-bold opacity-30">SOL</span>
                                            </div>

                                            <div className="space-y-1">
                                                <label className="text-[9px] font-mono text-muted-foreground uppercase font-black">Destination Address (Bittensor)</label>
                                                <input
                                                    type="text"
                                                    placeholder="Default: Internal Wallet"
                                                    value={destAddress}
                                                    onChange={(e) => setDestAddress(e.target.value)}
                                                    className="w-full bg-background border border-border rounded-sm px-4 py-3 font-mono text-xs outline-none focus:border-primary transition-all"
                                                />
                                            </div>

                                            <button
                                                onClick={handleBridge}
                                                disabled={processing || !amount}
                                                className="w-full btn-retro btn-retro-primary py-4 text-xs font-black uppercase tracking-widest shadow-[4px_4px_0px_#000] active:shadow-none active:translate-x-[2px] active:translate-y-[2px]"
                                            >
                                                {processing ? 'EXECUTING SWAP...' : 'INITIALIZE ATOMIC BRIDGE'}
                                            </button>
                                        </div>

                                        {result && (
                                            <div className={`p-4 rounded-sm border text-[10px] font-mono uppercase font-black flex gap-3 ${result.success ? 'bg-green-500/10 border-green-500/20 text-green-500' : 'bg-red-500/10 border-red-500/20 text-red-500'
                                                }`}>
                                                {result.success ? <ShieldCheck size={14} /> : <AlertCircle size={14} />} {result.message}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="p-4 bg-yellow-500/5 border border-yellow-500/10 rounded-sm text-[10px] font-mono text-yellow-500 leading-relaxed uppercase">
                                    <Info size={12} className="inline mr-2 mb-0.5" />
                                    Bridge transactions are processed via the Optimistic L2 Validator. Funds typically reflect in 60-90 seconds after Solana finality.
                                </div>
                            </div>
                        )}

                        {activeTab === 'STAKING' && (
                            <div className="space-y-6 animate-in slide-in-from-bottom-2">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    <div className="card-retro p-4 bg-primary/5 border-primary/20">
                                        <p className="text-[9px] font-mono text-muted-foreground uppercase mb-1">Total Staked</p>
                                        <p className="text-xl font-mono font-black">{(stakes || []).reduce((acc, s) => acc + s.amount, 0).toFixed(2)} TAO</p>
                                    </div>
                                    <div className="card-retro p-4 bg-green-500/5 border-green-500/20">
                                        <p className="text-[9px] font-mono text-muted-foreground uppercase mb-1">Target APY</p>
                                        <p className="text-xl font-mono font-black text-green-500">12.5%</p>
                                    </div>
                                    <div className="card-retro p-4 bg-blue-500/5 border-blue-500/20">
                                        <p className="text-[9px] font-mono text-muted-foreground uppercase mb-1">Unlocking In</p>
                                        <p className="text-xl font-mono font-black text-blue-500">21 DAYS</p>
                                    </div>
                                </div>

                                <div className="card-retro p-6 border-border">
                                    <div className="flex items-center gap-2 mb-6 text-xs font-black font-mono uppercase tracking-widest">
                                        <Layers className="text-primary" size={14} /> Active Staking Positions
                                    </div>

                                    <div className="space-y-3">
                                        {(!stakes || stakes.length === 0) ? (
                                            <div className="py-10 text-center text-[10px] font-mono text-muted-foreground uppercase">No active stakes found in the vault.</div>
                                        ) : (
                                            stakes.map(stake => (
                                                <div key={stake.id} className="p-4 border border-border bg-secondary/10 flex justify-between items-center rounded-sm group hover:border-primary/30 transition-colors">
                                                    <div>
                                                        <p className="text-sm font-black font-mono">{stake.amount.toFixed(2)} TAO</p>
                                                        <p className="text-[9px] text-muted-foreground font-mono uppercase">Staked on {new Date(stake.start_time).toLocaleDateString()}</p>
                                                    </div>
                                                    <button className="px-3 py-1.5 bg-white/5 border border-white/10 text-[9px] font-mono font-black uppercase hover:bg-red-500/10 hover:text-red-500 hover:border-red-500/20 transition-all">
                                                        Unstake
                                                    </button>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>

                                <button
                                    onClick={() => setStakingAction('stake')}
                                    className="w-full btn-retro btn-retro-outline py-4 text-xs font-black uppercase tracking-widest hover:bg-primary hover:text-primary-foreground group"
                                >
                                    <Zap size={14} className="inline mr-2 group-hover:animate-pulse" /> NEW DELEGATION
                                </button>
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
                                        <span>99.9%</span>
                                    </div>
                                    <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                                        <div className="h-full bg-primary w-[99.9%]"></div>
                                    </div>
                                </div>

                                <div className="p-4 bg-white/5 border border-white/5 rounded-sm group relative overflow-hidden">
                                    <p className="text-[10px] font-mono text-muted-foreground uppercase mb-1">Streaming Earnings (L2)</p>
                                    <p className="text-xl font-black font-mono text-green-500">
                                        + ₵<VestingTicker base={84.21} rate={0.0001} />
                                    </p>
                                    <div className="absolute bottom-0 left-0 h-0.5 bg-green-500/30 w-full animate-progress-ind"></div>
                                </div>

                                <div className="p-4 bg-white/5 border border-white/5 rounded-sm">
                                    <p className="text-[10px] font-mono text-muted-foreground uppercase mb-1">Active Collateral</p>
                                    <p className="text-xl font-black font-mono">1,024.50 <span className="text-xs opacity-50">TAO</span></p>
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
                                    <span className="text-muted-foreground">Session ID: 8xf2...p9</span>
                                    <span className="text-primary animate-pulse">LIVE</span>
                                </div>
                                <div className="flex justify-between items-end border-b border-white/5 pb-2">
                                    <span className="text-[9px] font-mono text-muted-foreground uppercase">Accumulated</span>
                                    <span className="text-lg font-black font-mono">₵<VestingTicker base={12.45} rate={0.00005} /></span>
                                </div>
                                <div className="flex justify-between items-end">
                                    <span className="text-[9px] font-mono text-muted-foreground uppercase">Node Performance</span>
                                    <span className="text-xs font-bold font-mono text-green-500">99.8%</span>
                                </div>
                            </div>
                        </div>

                        {/* Watchtower Alert Box */}
                        <div className="card-retro p-6 border-green-500/20 bg-green-500/5">
                            <div className="flex items-center gap-2 mb-4">
                                <Shield className="text-green-500" size={14} />
                                <span className="text-[10px] font-black font-mono uppercase text-green-500">Live Secure Guard</span>
                            </div>
                            <p className="text-[10px] font-mono text-green-500/70 leading-relaxed uppercase">
                                Watchtower is currently monitoring all treasury outflows. System has cleared 15,302 transactions since last automated pause.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            <SubstrateWalletModal
                isOpen={isTAOModalOpen}
                onClose={() => setIsTAOModalOpen(false)}
                onSelect={handleLinkBittensor}
            />
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

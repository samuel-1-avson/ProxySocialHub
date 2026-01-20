'use client';

import { useAuth } from '@/lib/auth';
import { useEffect, useState } from 'react';
import { getWallet, depositWallet, withdrawWallet, Wallet as WalletType } from '@/lib/api';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther, formatEther } from 'viem';
import { PROXY_MARKETPLACE_ABI, PROXY_MARKETPLACE_ADDRESS } from '@/lib/abis';
import {
    Wallet as WalletIcon,
    CreditCard,
    Smartphone,
    History,
    Zap,
    ArrowUpRight,
    ArrowDownLeft,
    X,
    Info,
    Clock,
    ShieldCheck,
    ArrowRight,
    Coins,
    Shield,
    Activity,
    Layers,
    Loader2,
    AlertCircle
} from 'lucide-react';

export default function WalletPage() {
    const { user } = useAuth();
    const [wallet, setWallet] = useState<WalletType | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'FIAT' | 'CRYPTO'>('CRYPTO');

    // Fiat State
    const [action, setAction] = useState<'deposit' | 'withdraw' | null>(null);
    const [amount, setAmount] = useState('');
    const [phone, setPhone] = useState('');
    const [network, setNetwork] = useState('MTN');
    const [processing, setProcessing] = useState(false);
    const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

    // Crypto State
    const { address, isConnected } = useAccount(); // Still keeping this for potential ETH interoperability
    // We should ideally use a Sol/Polkadot hook here if we want native Tao, but for now we might be using the Login Identity.
    // The user has 'wallet' object from backend which holds the TAO balance.

    // We import depositCrypto from api
    const { depositCrypto } = require('@/lib/api');
    const [cryptoAmount, setCryptoAmount] = useState('');
    const [cryptoProcessing, setCryptoProcessing] = useState(false);
    const [cryptoResult, setCryptoResult] = useState<{ success: boolean; message: string } | null>(null);


    useEffect(() => {
        fetchWallet();
    }, []);

    async function fetchWallet() {
        try {
            const data = await getWallet();
            setWallet(data);
        } catch (error) {
            console.error('Failed to fetch wallet:', error);
        } finally {
            setLoading(false);
        }
    }

    async function handleDeposit(e: React.FormEvent) {
        e.preventDefault();
        if (!user?.email) {
            setResult({ success: false, message: 'User identity not found. Re-establishing connection...' });
            return;
        }

        setProcessing(true);
        setResult(null);
        try {
            const res = await depositWallet(parseFloat(amount), user.email);
            setResult({ success: true, message: 'Redirecting to secure payment nexus...' });

            if (res.authorization_url) {
                window.location.href = res.authorization_url;
            } else {
                setResult({ success: false, message: 'Encryption failure: Failed to generate protocol URL.' });
            }
        } catch (error: any) {
            console.error('Deposit error:', error);
            setResult({ success: false, message: 'Transaction aborted. Please retry the protocol.' });
        } finally {
            setProcessing(false);
        }
    }

    async function handleWithdraw(e: React.FormEvent) {
        e.preventDefault();
        setProcessing(true);
        setResult(null);
        try {
            const res = await withdrawWallet(parseFloat(amount), phone, network);
            setResult({ success: true, message: `Withdrawal authorized. Syncing balance...` });
            setAmount('');
            setPhone('');
            setTimeout(() => {
                fetchWallet();
                setAction(null);
            }, 3000);
        } catch {
            setResult({ success: false, message: 'Authorization denied. Insufficient resources or invalid target.' });
        } finally {
            setProcessing(false);
        }
    }

    async function handleCryptoDeposit(e: React.FormEvent) {
        e.preventDefault();
        if (!cryptoAmount) return;
        setCryptoProcessing(true);
        setCryptoResult(null);

        try {
            // Simulator: We just ask for amount using the API. In real world, we would ask for TX Hash.
            // For MVP, we can generate a mock hash or ask user.
            // Let's assume we just call the API and it simulates/verifies.
            const res = await depositCrypto(parseFloat(cryptoAmount), "0xSIMULATED_HASH_" + Date.now());
            setCryptoResult({ success: true, message: "Deposit Verified! " + res.message });
            setCryptoAmount('');
            fetchWallet(); // Refresh balance
        } catch (err: any) {
            setCryptoResult({ success: false, message: err.message || "Deposit failed" });
        } finally {
            setCryptoProcessing(false);
        }
    }


    /* ... render methods ... */

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-border pb-6">
                <div>
                    <h1 className="text-3xl font-bold font-mono uppercase tracking-tight mb-1">Financial Core</h1>
                    <p className="text-muted-foreground font-mono text-xs">MANAGE ASSETS AND SETTLEMENTS.</p>
                </div>

                {/* Mode Switcher */}
                <div className="flex p-1 rounded-sm bg-secondary/20 border border-border">
                    <button
                        onClick={() => setActiveTab('CRYPTO')}
                        className={`px-4 py-2 rounded-sm text-xs font-mono font-bold uppercase transition-all ${activeTab === 'CRYPTO'
                            ? 'bg-primary text-primary-foreground shadow-sm' // TAO is primary now
                            : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
                            }`}
                    >
                        TAO (Bittensor)
                    </button>
                    <button
                        onClick={() => setActiveTab('FIAT')}
                        className={`px-4 py-2 rounded-sm text-xs font-mono font-bold uppercase transition-all ${activeTab === 'FIAT'
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
                            }`}
                    >
                        Fiat (GHS)
                    </button>

                </div>
            </div>

            {/* CRYPTO MODE */}
            {activeTab === 'CRYPTO' && (
                <div className="space-y-6">
                    <div className="card-retro p-8 bg-card flex flex-col items-center text-center space-y-6">
                        <div className="p-4 bg-primary/10 rounded-full border border-primary/20">
                            <Layers className="w-12 h-12 text-primary" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold font-mono uppercase">AI-Native Settlement</h2>
                            <p className="text-xs font-mono text-muted-foreground mt-2 max-w-md mx-auto">
                                PRIMARY CURRENCY FOR AI AGENT RENTALS AND DATA SERVICES.
                            </p>
                        </div>

                        { /* We don't strictly need ConnectButton for 'viewing' balance if it's in the DB, 
                             but it's good for 'Connecting' to deposit. For now, showing DB balance is key. */ }

                        <div className="w-full max-w-3xl pt-8 border-t border-border mt-8 grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
                            {/* TAO Balance */}
                            <div className="p-6 border border-primary/30 bg-primary/5 rounded-sm">
                                <p className="text-[10px] font-mono font-bold text-primary uppercase tracking-widest mb-2">Core Balance</p>
                                <p className="text-3xl font-bold font-mono tracking-tighter">
                                    {wallet?.balance_tao?.toFixed(4) || '0.0000'} <span className="text-sm opacity-50">TAO</span>
                                </p>
                            </div>

                            {/* Unclaimed Earnings / Other */}
                            <div className="p-6 border border-green-500/30 bg-green-500/5 rounded-sm">
                                <p className="text-[10px] font-mono font-bold text-green-500 uppercase tracking-widest mb-2">Pending Yield</p>
                                <p className="text-3xl font-bold font-mono tracking-tighter">
                                    0.000 <span className="text-sm opacity-50">TAO</span>
                                </p>
                            </div>

                            <div className="md:col-span-2 card-retro p-6 bg-card border-border">
                                <h3 className="text-xs font-bold font-mono uppercase text-muted-foreground mb-4">Deposit TAO</h3>
                                <form onSubmit={handleCryptoDeposit} className="flex gap-2">
                                    <input
                                        type="number"
                                        step="0.0001"
                                        placeholder="AMOUNT (TAO)"
                                        value={cryptoAmount}
                                        onChange={(e) => setCryptoAmount(e.target.value)}
                                        className="flex-1 bg-background border border-border rounded-sm px-4 py-2 font-mono text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                                    />
                                    <button
                                        type="submit"
                                        disabled={cryptoProcessing}
                                        className="btn-retro btn-retro-primary text-xs py-2 px-6"
                                    >
                                        {cryptoProcessing ? '...' : 'DEPOSIT'}
                                    </button>
                                </form>
                                {cryptoResult && (
                                    <div className={`mt-4 p-3 border text-xs font-mono break-all rounded-sm ${cryptoResult.success ? 'bg-green-500/10 border-green-500/20 text-green-600' : 'bg-destructive/10 border-destructive/20 text-destructive'
                                        }`}>
                                        {cryptoResult.message}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* FIAT MODE */}
            {activeTab === 'FIAT' && (
                <>
                    {/* Balance & Actions */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div className="lg:col-span-2 card-retro p-8 bg-card flex flex-col justify-between relative overflow-hidden group">
                            <div className="relative z-10">
                                <div className="flex items-center gap-2 mb-6">
                                    <WalletIcon size={16} className="text-primary" />
                                    <span className="text-xs font-mono font-bold uppercase text-muted-foreground">Protocol Balance</span>
                                </div>
                                <div className="text-6xl font-black font-mono tracking-tighter mb-2 flex items-baseline gap-2">
                                    <span className="text-2xl opacity-40 text-muted-foreground font-bold">₵</span>
                                    {wallet?.balance_ghs?.toFixed(2) || '0.00'}
                                </div>
                                <div className="flex items-center gap-2 text-[10px] font-mono font-bold text-green-500 uppercase tracking-widest">
                                    <Activity size={12} />
                                    Synchronized
                                </div>
                            </div>
                            <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
                                <Coins size={150} />
                            </div>
                        </div>

                        <div className="space-y-4">
                            <button
                                onClick={() => { setAction('deposit'); setResult(null); }}
                                className="w-full h-[calc(50%-8px)] btn-retro btn-retro-primary flex flex-col items-center justify-center gap-2 py-6"
                            >
                                <ArrowDownLeft size={24} />
                                <span className="text-xs">INITIALIZE DEPOSIT</span>
                            </button>
                            <button
                                onClick={() => { setAction('withdraw'); setResult(null); }}
                                className="w-full h-[calc(50%-8px)] btn-retro btn-retro-outline bg-card hover:bg-accent flex flex-col items-center justify-center gap-2 py-6"
                            >
                                <ArrowUpRight size={24} />
                                <span className="text-xs">WITHDRAW CREDITS</span>
                            </button>
                        </div>
                    </div>

                    {/* Transaction History */}
                    <div className="card-retro p-0 bg-card">
                        <div className="p-6 border-b border-border flex justify-between items-center">
                            <h3 className="font-bold font-mono uppercase flex items-center gap-2">
                                <History size={16} />
                                Transaction Ledger
                            </h3>
                            <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">REAL-TIME</div>
                        </div>

                        <div className="overflow-x-auto">
                            {(!wallet?.transactions || wallet.transactions.length === 0) ? (
                                <div className="p-12 text-center">
                                    <div className="w-12 h-12 bg-secondary/30 rounded-full flex items-center justify-center mx-auto mb-4">
                                        <History size={20} className="text-muted-foreground opacity-50" />
                                    </div>
                                    <p className="font-mono text-xs text-muted-foreground uppercase">Ledger Empty</p>
                                </div>
                            ) : (
                                <table className="w-full text-left font-mono text-xs">
                                    <thead className="bg-secondary/20 border-b border-border">
                                        <tr>
                                            <th className="px-6 py-3 font-bold uppercase text-muted-foreground">Type</th>
                                            <th className="px-6 py-3 font-bold uppercase text-muted-foreground">Amount</th>
                                            <th className="px-6 py-3 font-bold uppercase text-muted-foreground">Status</th>
                                            <th className="px-6 py-3 font-bold uppercase text-muted-foreground">Date</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {wallet.transactions.map((tx) => (
                                            <tr key={tx.id} className="hover:bg-accent/30 transition-colors">
                                                <td className="px-6 py-4">
                                                    <div className="font-bold uppercase mb-0.5">{tx.description}</div>
                                                    <div className="text-[10px] text-muted-foreground uppercase opacity-70">{tx.type}</div>
                                                </td>
                                                <td className={`px-6 py-4 font-bold tabular-nums text-sm ${tx.amount >= 0 ? 'text-primary' : 'text-destructive'}`}>
                                                    {tx.amount >= 0 ? '+' : ''}{tx.amount.toFixed(2)}
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-sm border text-[10px] font-bold uppercase ${tx.status === 'success' || tx.status === 'completed'
                                                        ? 'bg-primary/10 border-primary/20 text-primary'
                                                        : tx.status === 'failed'
                                                            ? 'bg-destructive/10 border-destructive/20 text-destructive'
                                                            : 'bg-yellow-500/10 border-yellow-500/20 text-yellow-500'
                                                        }`}>
                                                        {tx.status === 'processing' ? 'PENDING' : (tx.status || 'SETTLED')}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-muted-foreground">
                                                    {new Date(tx.created_at).toLocaleDateString()}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>

                    {/* Modal Overlay */}
                    {action && (
                        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
                            <div className="card-retro p-8 bg-card max-w-md w-full relative animate-in zoom-in-95 duration-300 shadow-2xl">
                                <button
                                    onClick={() => setAction(null)}
                                    className="absolute top-4 right-4 text-muted-foreground hover:text-foreground hover:rotate-90 transition-all"
                                >
                                    <X size={20} />
                                </button>

                                <div className="mb-6 flex items-center gap-3 border-b-2 border-border pb-4">
                                    <div className={`p-3 rounded-sm border-2 border-foreground shadow-[2px_2px_0px_var(--foreground)] ${action === 'deposit' ? 'bg-primary text-primary-foreground' : 'bg-blue-600 text-white'
                                        }`}>
                                        {action === 'deposit' ? <ArrowDownLeft size={24} /> : <ArrowUpRight size={24} />}
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-bold font-mono uppercase">
                                            {action === 'deposit' ? 'Protocol Deposit' : 'Request Payout'}
                                        </h3>
                                        <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                                            {action === 'deposit' ? 'VIA SECURE GATEWAY' : 'TO MOBILE TERMINAL'}
                                        </p>
                                    </div>
                                </div>

                                {result && (
                                    <div className={`mb-6 p-4 rounded-sm border text-xs font-mono flex gap-3 ${result.success ? 'bg-primary/10 border-primary/20 text-primary' : 'bg-destructive/10 border-destructive/20 text-destructive'
                                        }`}>
                                        {result.success ? <ShieldCheck size={16} className="shrink-0" /> : <AlertCircle size={16} className="shrink-0" />}
                                        <p>{result.message}</p>
                                    </div>
                                )}

                                <form onSubmit={action === 'deposit' ? handleDeposit : handleWithdraw} className="space-y-6">
                                    <div className="space-y-4">
                                        <div className="space-y-2">
                                            <label className="text-xs font-mono font-bold uppercase text-muted-foreground">Amount (GHS)</label>
                                            <div className="relative">
                                                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono font-bold text-muted-foreground">₵</span>
                                                <input
                                                    type="number"
                                                    value={amount}
                                                    onChange={(e) => setAmount(e.target.value)}
                                                    placeholder={action === 'deposit' ? '10.00' : '50.00'}
                                                    min={action === 'deposit' ? 1 : 5}
                                                    step="0.01"
                                                    required
                                                    className="w-full bg-background border border-border rounded-sm py-3 pl-8 pr-4 font-mono text-lg font-bold outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                                                />
                                            </div>
                                        </div>

                                        {action === 'deposit' && (
                                            <div className="flex gap-2">
                                                {[50, 100, 500].map((val) => (
                                                    <button
                                                        key={val}
                                                        type="button"
                                                        onClick={() => setAmount(val.toString())}
                                                        className="flex-1 py-1 text-xs font-mono font-bold bg-secondary/10 border border-border hover:bg-secondary/20 hover:border-primary transition-colors text-muted-foreground hover:text-foreground"
                                                    >
                                                        + {val}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    {action === 'withdraw' && (
                                        <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                                            <div className="space-y-2">
                                                <label className="text-xs font-mono font-bold uppercase text-muted-foreground">Network</label>
                                                <div className="grid grid-cols-3 gap-2">
                                                    {['MTN', 'TELECEL', 'AT'].map((net) => (
                                                        <button
                                                            key={net}
                                                            type="button"
                                                            onClick={() => setNetwork(net)}
                                                            className={`py-2 rounded-sm text-xs font-bold font-mono border-2 transition-all ${network === net
                                                                ? 'border-blue-500 bg-blue-500/10 text-blue-500 shadow-[2px_2px_0px_currentColor]'
                                                                : 'border-border bg-background text-muted-foreground hover:border-foreground'
                                                                }`}
                                                        >
                                                            {net}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-xs font-mono font-bold uppercase text-muted-foreground">Mobile Number</label>
                                                <div className="relative">
                                                    <Smartphone className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                                                    <input
                                                        type="tel"
                                                        value={phone}
                                                        onChange={(e) => setPhone(e.target.value)}
                                                        placeholder="02XXXXXXXX"
                                                        required
                                                        className="w-full bg-background border border-border rounded-sm py-3 pl-10 pr-4 font-mono text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    <button
                                        type="submit"
                                        disabled={processing}
                                        className={`w-full py-3 mt-2 rounded-sm font-bold font-mono uppercase border-2 shadow-[4px_4px_0px_#000] active:shadow-none active:translate-x-[4px] active:translate-y-[4px] transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2 ${action === 'deposit'
                                            ? 'bg-primary border-black text-black'
                                            : 'bg-blue-600 border-black text-white'
                                            }`}
                                    >
                                        {processing ? (
                                            <>
                                                <Loader2 size={16} className="animate-spin" />
                                                PROCESSING...
                                            </>
                                        ) : (
                                            <>
                                                {action === 'deposit' ? 'INITIATE DEPOSIT' : 'CONFIRM WITHDRAWAL'}
                                                <ArrowRight size={16} />
                                            </>
                                        )}
                                    </button>
                                </form>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

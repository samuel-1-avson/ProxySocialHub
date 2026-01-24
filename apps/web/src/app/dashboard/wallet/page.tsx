'use client';

import { useAuth } from '@/lib/auth';
import { useEffect, useState } from 'react';
import { getWallet, depositWallet, withdrawWallet, linkWallet, getStakes, stakeFunds, unstakeFunds, transferFunds, getSystemConfig, startFaucet, getFaucetStatus, Wallet as WalletType, StakingPosition } from '@/lib/api'; // Added getSystemConfig

import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import { useWallet } from '@solana/wallet-adapter-react';
import { SolanaWalletButton } from '@/components/SolanaWalletButton';
import bs58 from 'bs58';
import { Connection, SystemProgram, Transaction, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
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

    AlertCircle,
    Hammer,
    CheckCircle
} from 'lucide-react';


export default function WalletPage() {
    const { user } = useAuth();
    const [wallet, setWallet] = useState<WalletType | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'FIAT' | 'CRYPTO'>('CRYPTO');
    const [treasuryConfig, setTreasuryConfig] = useState<{ treasury_solana: string; treasury_tao: string } | null>(null);

    // Fiat State
    const [action, setAction] = useState<'deposit' | 'withdraw' | null>(null);
    const [amount, setAmount] = useState('');
    const [phone, setPhone] = useState('');
    const [network, setNetwork] = useState('MTN');
    const [processing, setProcessing] = useState(false);
    const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

    // Crypto State
    const { isConnected: isEthConnected } = useAccount();
    const { connected, publicKey, signMessage, signTransaction, sendTransaction } = useWallet();

    const { depositCrypto } = require('@/lib/api');
    const [cryptoAmount, setCryptoAmount] = useState('');
    const [cryptoTxHash, setCryptoTxHash] = useState('');
    const [cryptoChain, setCryptoChain] = useState<'solana' | 'bittensor'>('solana');
    const [cryptoProcessing, setCryptoProcessing] = useState(false);
    const [cryptoResult, setCryptoResult] = useState<{ success: boolean; message: string } | null>(null);

    // Staking & P2P State
    const [stakes, setStakes] = useState<StakingPosition[]>([]);
    const [stakingAction, setStakingAction] = useState<'stake' | 'unstake' | null>(null);
    const [stakeAmount, setStakeAmount] = useState('');
    const [p2pRecipient, setP2PRecipient] = useState('');
    const [p2pAmount, setP2PAmount] = useState('');
    const [p2pCurrency, setP2PCurrency] = useState<'TAO' | 'GHS'>('TAO');

    // Faucet State
    const [faucetStatus, setFaucetStatus] = useState<string>('IDLE');
    const [faucetElapsed, setFaucetElapsed] = useState<number>(0);
    const [faucetMessage, setFaucetMessage] = useState<string>('');


    useEffect(() => {
        fetchWallet();
        fetchConfig();
        if (activeTab === 'CRYPTO' && user) {
            fetchStakes();
        }

        // Auto-refresh mechanism (Polling 10s)
        const interval = setInterval(() => {
            fetchWallet();
            if (activeTab === 'CRYPTO') fetchStakes();
        }, 10000);

        return () => clearInterval(interval);

    }, [activeTab]);

    useEffect(() => {
        if (faucetStatus === 'MINING' || faucetStatus === 'STARTING') {
            const interval = setInterval(async () => {
                try {
                    const status = await getFaucetStatus();
                    setFaucetStatus(status.status);
                    setFaucetElapsed(status.elapsed_seconds);
                    setFaucetMessage(status.message);
                    if (status.status === 'SUCCESS' || status.status === 'ERROR') {
                        fetchWallet(); // Refresh balance
                    }
                } catch (e) { console.error("Faucet polling error", e); }
            }, 5000);
            return () => clearInterval(interval);
        }
    }, [faucetStatus]);

    async function handleStartFaucet() {
        try {
            const res = await startFaucet();
            setFaucetStatus('STARTING');
            setFaucetMessage(res.message);
        } catch (e: any) {
            setCryptoResult({ success: false, message: e.message || 'Failed to start faucet' });
        }
    }


    async function fetchConfig() {
        try {
            const cfg = await getSystemConfig();
            setTreasuryConfig(cfg);
        } catch (e) { console.error("Config fetch error", e); }
    }

    async function handleSmartDeposit() {
        if (!publicKey || !signTransaction) return;
        if (!treasuryConfig?.treasury_solana) {
            setCryptoResult({ success: false, message: 'Treasury config missing' });
            return;
        }

        setCryptoProcessing(true);
        setCryptoResult(null);

        try {
            const connection = new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC || 'https://api.devnet.solana.com');
            const destPubkey = new PublicKey(treasuryConfig.treasury_solana);
            const amount = parseFloat(cryptoAmount);
            const lamports = amount * LAMPORTS_PER_SOL;

            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: publicKey,
                    toPubkey: destPubkey,
                    lamports: BigInt(Math.floor(lamports)),
                })
            );

            const { blockhash } = await connection.getLatestBlockhash();
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = publicKey;

            // Use sendTransaction from wallet adapter which handles signing
            const signature = await sendTransaction(transaction, connection);
            await connection.confirmTransaction(signature, 'processed');

            // Verify with backend
            const res = await depositCrypto(amount, signature, 'solana');

            setCryptoResult({ success: true, message: `Deposit Verified! Credited ${res.credited_tao?.toFixed(4) || amount} TAO` });
            setCryptoAmount('');
            fetchWallet();

        } catch (err: any) {
            console.error(err);
            setCryptoResult({ success: false, message: 'Deposit failed: ' + (err.message || 'Transaction denied') });
        } finally {
            setCryptoProcessing(false);
        }
    }

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

    async function fetchStakes() {
        try {
            const data = await getStakes();
            setStakes(data);
        } catch (err) {
            console.error(err);
        }
    }

    async function handleStake(e: React.FormEvent) {
        e.preventDefault();
        setCryptoProcessing(true);
        try {
            await stakeFunds(parseFloat(stakeAmount));
            setCryptoResult({ success: true, message: 'Staked Successfully!' });
            setStakeAmount('');
            setStakingAction(null);
            fetchWallet();
            fetchStakes();
        } catch (err: any) {
            setCryptoResult({ success: false, message: err.message || 'Staking failed' });
        } finally {
            setCryptoProcessing(false);
        }
    }

    async function handleUnstake(stakeId: string) {
        setCryptoProcessing(true);
        try {
            await unstakeFunds(stakeId);
            setCryptoResult({ success: true, message: 'Unstaked Successfully!' });
            fetchWallet();
            fetchStakes();
        } catch (err: any) {
            setCryptoResult({ success: false, message: err.message || 'Unstaking failed' });
        } finally {
            setCryptoProcessing(false);
        }
    }

    async function handleP2PTransfer(e: React.FormEvent) {
        e.preventDefault();
        setCryptoProcessing(true);
        try {
            await transferFunds(p2pRecipient, parseFloat(p2pAmount), p2pCurrency);
            setCryptoResult({ success: true, message: `Sent ${p2pAmount} ${p2pCurrency} to ${p2pRecipient}` });
            setP2PAmount('');
            setP2PRecipient('');
            fetchWallet();
        } catch (err: any) {
            setCryptoResult({ success: false, message: err.message || 'Transfer failed' });
        } finally {
            setCryptoProcessing(false);
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
        if (!cryptoAmount || !cryptoTxHash) {
            setCryptoResult({ success: false, message: 'Please provide both amount and transaction hash' });
            return;
        }
        setCryptoProcessing(true);
        setCryptoResult(null);

        try {
            // Real deposit verification using on-chain transaction hash
            const res = await depositCrypto(
                parseFloat(cryptoAmount),
                cryptoTxHash.trim(),
                cryptoChain
            );
            setCryptoResult({ success: true, message: `Deposit Verified! Credited ${res.credited_tao?.toFixed(4) || cryptoAmount} TAO` });
            setCryptoAmount('');
            setCryptoTxHash('');
            fetchWallet(); // Refresh balance
        } catch (err: any) {
            // Handle specific error codes
            if (err.status === 409) {
                setCryptoResult({
                    success: false,
                    message: '⚠️ Transaction already processed. This deposit has been verified previously.'
                });
            } else if (err.status === 400) {
                setCryptoResult({
                    success: false,
                    message: `❌ Verification failed: ${err.message || 'Invalid transaction or amount mismatch'}`
                });
            } else if (err.status === 500) {
                setCryptoResult({
                    success: false,
                    message: '🔧 Server error. Please try again later.'
                });
            } else {
                setCryptoResult({
                    success: false,
                    message: err.message || "Deposit verification failed - check transaction hash"
                });
            }
        } finally {
            setCryptoProcessing(false);
        }
    }

    async function handleLinkWallet() {
        if (!publicKey || !user?.id) return;
        if (!signMessage) {
            setCryptoResult({ success: false, message: "Wallet does not support signing" });
            return;
        }

        setCryptoProcessing(true);
        setCryptoResult(null);
        try {
            const message = `Link Wallet ${publicKey.toBase58()} to ProxyHubb User ${user.id}`;
            const encodedMessage = new TextEncoder().encode(message);
            const signatureBytes = await signMessage(encodedMessage);
            const signature = bs58.encode(signatureBytes);

            await linkWallet(publicKey.toBase58(), 'solana', signature, message);
            setCryptoResult({ success: true, message: "Wallet Linked Successfully" });
            fetchWallet();
        } catch (err: any) {
            console.error(err);
            setCryptoResult({ success: false, message: err.message || "Linking failed" });
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

                            {/* Staking Section */}
                            <div className="md:col-span-1 card-retro p-6 bg-card border-border">
                                <div className="flex justify-between items-center mb-4">
                                    <h3 className="text-xs font-bold font-mono uppercase text-muted-foreground flex items-center gap-2">
                                        <Layers size={14} className="text-primary" /> Staking Vault
                                    </h3>
                                    <span className="text-[10px] font-mono bg-green-500/10 text-green-500 px-2 py-0.5 rounded-full border border-green-500/20">15% APY</span>
                                </div>

                                <div className="space-y-4">
                                    <div className="bg-secondary/5 rounded-sm p-4 border border-border">
                                        <p className="text-[10px] font-mono text-muted-foreground uppercase mb-1">Active Stake</p>
                                        <p className="text-2xl font-bold font-mono text-white">
                                            {(stakes || []).reduce((acc, s) => acc + (s.status === 'active' ? s.amount : 0), 0).toFixed(4)} <span className="text-sm text-muted-foreground">TAO</span>
                                        </p>
                                        <p className="text-[10px] font-mono text-green-500 mt-1">
                                            + {(stakes || []).reduce((acc, s) => acc + (s.current_yield || 0), 0).toFixed(6)} Pending Yield
                                        </p>
                                    </div>

                                    {/* Action Buttons */}
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => setStakingAction('stake')}
                                            className="flex-1 py-2 text-xs font-bold font-mono uppercase bg-primary text-primary-foreground rounded-sm hover:-translate-y-0.5 transition-transform"
                                        >
                                            Stake
                                        </button>
                                        <button
                                            onClick={() => setStakingAction('unstake')}
                                            className="flex-1 py-2 text-xs font-bold font-mono uppercase bg-secondary/20 text-foreground border border-border rounded-sm hover:bg-secondary/30 transition-colors"
                                        >
                                            Unstake
                                        </button>
                                    </div>

                                    {stakingAction === 'stake' && (
                                        <form onSubmit={handleStake} className="space-y-2 animate-in fade-in slide-in-from-top-2 pt-2 border-t border-border">
                                            <input
                                                type="number"
                                                step="0.01"
                                                placeholder="Amount to Stake"
                                                value={stakeAmount}
                                                onChange={(e) => setStakeAmount(e.target.value)}
                                                className="w-full bg-background border border-border rounded-sm px-3 py-2 text-xs font-mono outline-none focus:border-primary"
                                            />
                                            <button type="submit" disabled={cryptoProcessing} className="w-full py-1.5 text-[10px] bg-primary/20 text-primary border border-primary/50 font-bold uppercase rounded-sm hover:bg-primary/30">
                                                {cryptoProcessing ? 'Processing...' : 'Confirm Stake'}
                                            </button>
                                        </form>
                                    )}

                                    {stakingAction === 'unstake' && (
                                        <div className="space-y-2 animate-in fade-in slide-in-from-top-2 pt-2 border-t border-border">
                                            {(stakes || []).filter(s => s.status === 'active').length === 0 ? (
                                                <p className="text-[10px] text-muted-foreground text-center py-2">No active stakes</p>
                                            ) : (
                                                (stakes || []).filter(s => s.status === 'active').map(s => (
                                                    <div key={s.id} className="flex justify-between items-center bg-secondary/10 p-2 rounded-sm text-xs border border-border">
                                                        <div>
                                                            <div className="font-bold">{s.amount.toFixed(2)} TAO</div>
                                                            <div className="text-[10px] text-muted-foreground">{new Date(s.start_time).toLocaleDateString()}</div>
                                                        </div>
                                                        <button
                                                            onClick={() => handleUnstake(s.id)}
                                                            disabled={cryptoProcessing}
                                                            className="text-[10px] bg-red-500/10 text-red-500 border border-red-500/20 px-2 py-1 rounded-sm hover:bg-red-500/20"
                                                        >
                                                            Unstake
                                                        </button>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* P2P Transfer Section */}
                            <div className="md:col-span-1 card-retro p-6 bg-card border-border">
                                <div className="flex justify-between items-center mb-4">
                                    <h3 className="text-xs font-bold font-mono uppercase text-muted-foreground flex items-center gap-2">
                                        <ArrowRight size={14} className="text-blue-400" /> P2P Transfer
                                    </h3>
                                    <span className="text-[10px] font-mono bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full border border-blue-500/20">Zero Fee</span>
                                </div>

                                <form onSubmit={handleP2PTransfer} className="space-y-3">
                                    <input
                                        type="text"
                                        placeholder="Recipient (Email/Username)"
                                        value={p2pRecipient}
                                        onChange={(e) => setP2PRecipient(e.target.value)}
                                        className="w-full bg-background border border-border rounded-sm px-3 py-2 text-xs font-mono outline-none focus:border-blue-500"
                                    />
                                    <div className="flex gap-2">
                                        <div className="relative w-2/3">
                                            <input
                                                type="number"
                                                step="0.01"
                                                placeholder="Amount"
                                                value={p2pAmount}
                                                onChange={(e) => setP2PAmount(e.target.value)}
                                                className="w-full bg-background border border-border rounded-sm px-3 py-2 text-xs font-mono outline-none focus:border-blue-500"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setP2PAmount(p2pCurrency === 'TAO' ? (wallet?.balance_tao || 0).toString() : (wallet?.balance_ghs || 0).toString())}
                                                className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-blue-400 font-bold hover:text-blue-300"
                                            >
                                                MAX
                                            </button>
                                        </div>
                                        <select
                                            value={p2pCurrency}
                                            onChange={(e) => setP2PCurrency(e.target.value as 'TAO' | 'GHS')}
                                            className="w-1/3 bg-background border border-border rounded-sm px-1 py-1 text-[10px] font-mono outline-none uppercase"
                                        >
                                            <option value="TAO">TAO</option>
                                            <option value="GHS">GHS</option>
                                        </select>
                                    </div>
                                    <button
                                        type="submit"
                                        disabled={cryptoProcessing}
                                        className="w-full py-2 text-xs font-bold font-mono uppercase bg-blue-600 text-white rounded-sm hover:bg-blue-700 shadow-sm"
                                    >
                                        {cryptoProcessing ? 'Sending...' : 'Send Funds'}
                                    </button>
                                </form>
                            </div>

                            <div className="md:col-span-2 card-retro p-6 bg-card border-border">
                                <h3 className="text-xs font-bold font-mono uppercase text-muted-foreground mb-4">Deposit Crypto</h3>

                                {/* Chain Selector */}
                                <div className="flex gap-2 mb-4">
                                    <button
                                        type="button"
                                        onClick={() => setCryptoChain('solana')}
                                        className={`flex-1 py-2 px-4 text-xs font-mono font-bold uppercase rounded-sm border transition-all ${cryptoChain === 'solana'
                                            ? 'bg-purple-500/20 border-purple-500 text-purple-400'
                                            : 'border-border text-muted-foreground hover:border-purple-500/50'
                                            }`}
                                    >
                                        SOL (Solana)
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setCryptoChain('bittensor')}
                                        className={`flex-1 py-2 px-4 text-xs font-mono font-bold uppercase rounded-sm border transition-all ${cryptoChain === 'bittensor'
                                            ? 'bg-primary/20 border-primary text-primary'
                                            : 'border-border text-muted-foreground hover:border-primary/50'
                                            }`}
                                    >
                                        TAO (Bittensor)
                                    </button>
                                </div>

                                {/* Smart Deposit Logic */}
                                {cryptoChain === 'solana' ? (
                                    <div className="space-y-4">
                                        <div className="p-4 bg-purple-500/10 border border-purple-500/20 rounded-sm">
                                            <p className="text-[10px] font-mono text-purple-400 uppercase mb-2 flex items-center gap-2">
                                                <Zap size={12} /> Instant Deposit
                                            </p>
                                            <div className="flex gap-2">
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    placeholder="Amount (SOL)"
                                                    value={cryptoAmount}
                                                    onChange={(e) => setCryptoAmount(e.target.value)}
                                                    className="flex-1 bg-background border border-border rounded-sm px-4 py-2 font-mono text-sm outline-none focus:border-purple-500"
                                                />
                                                <button
                                                    onClick={handleSmartDeposit}
                                                    disabled={cryptoProcessing || !cryptoAmount || !connected}
                                                    className="btn-retro bg-purple-600 text-white border-purple-800 text-xs py-2 px-6 disabled:opacity-50 hover:bg-purple-700"
                                                >
                                                    {cryptoProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : 'DEPOSIT SOL'}
                                                </button>
                                            </div>
                                            {!connected && <p className="text-[10px] text-red-400 mt-2">Connect Wallet first!</p>}
                                        </div>
                                    </div>

                                ) : (
                                    <div className="mb-4 p-3 bg-secondary/10 border border-border rounded-sm">
                                        {/* Bittensor Fallback (Manual) */}
                                        <p className="text-[10px] font-mono text-muted-foreground uppercase mb-1">
                                            Send TAO to Treasury:
                                        </p>
                                        <p className="text-xs font-mono text-foreground break-all select-all">
                                            {treasuryConfig?.treasury_tao || 'Loading...'}
                                        </p>

                                        <form onSubmit={handleCryptoDeposit} className="space-y-3 mt-4">
                                            <input
                                                type="text"
                                                placeholder="TRANSACTION HASH"
                                                value={cryptoTxHash}
                                                onChange={(e) => setCryptoTxHash(e.target.value)}
                                                className="w-full bg-background border border-border rounded-sm px-4 py-2 font-mono text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                                            />
                                            <div className="flex gap-2">
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
                                                    disabled={cryptoProcessing || !cryptoTxHash || !cryptoAmount}
                                                    className="btn-retro btn-retro-primary text-xs py-2 px-6 disabled:opacity-50"
                                                >
                                                    {cryptoProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : 'VERIFY'}
                                                </button>
                                            </div>
                                        </form>
                                    </div>

                                )}

                                {/* Faucet Section (Only for Bittensor) */}
                                {cryptoChain === 'bittensor' && (
                                    <div className="mt-6 pt-6 border-t border-border">
                                        <div className="flex items-center justify-between mb-4">
                                            <div>
                                                <h4 className="text-xs font-bold font-mono uppercase text-muted-foreground flex items-center gap-2">
                                                    <Hammer size={14} className="text-yellow-500" /> Testnet Faucet
                                                </h4>
                                                <p className="text-[10px] text-muted-foreground">Mine local testnet tokens (PoW)</p>
                                            </div>
                                            {faucetStatus === 'MINING' && (
                                                <div className="text-[10px] font-mono text-yellow-500 animate-pulse">
                                                    Mining... {faucetElapsed}s
                                                </div>
                                            )}
                                        </div>

                                        {faucetStatus === 'MINING' || faucetStatus === 'STARTING' ? (
                                            <div className="bg-secondary/10 p-4 rounded-sm border border-border">
                                                <div className="flex items-center gap-3">
                                                    <Loader2 className="animate-spin text-yellow-500" size={20} />
                                                    <div className="space-y-1 w-full">
                                                        <p className="text-xs font-mono">{faucetMessage || "Solving Proof-of-Work..."}</p>
                                                        <div className="h-1 w-full bg-secondary rounded-full overflow-hidden">
                                                            <div className="h-full bg-yellow-500 animate-pulse w-full"></div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : faucetStatus === 'SUCCESS' ? (
                                            <div className="bg-green-500/10 p-4 rounded-sm border border-green-500/20 text-green-500 flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <CheckCircle size={16} />
                                                    <span className="text-xs font-mono font-bold">TOKENS RECEIVED</span>
                                                </div>
                                                <button onClick={() => setFaucetStatus('IDLE')} className="text-[10px] underline hover:text-green-400">Reset</button>
                                            </div>
                                        ) : faucetStatus === 'ERROR' ? (
                                            <div className="bg-destructive/10 p-4 rounded-sm border border-destructive/20 text-destructive flex items-center justify-between">
                                                <div className="flex items-start gap-2">
                                                    <AlertCircle size={16} className="mt-0.5" />
                                                    <div>
                                                        <span className="text-xs font-mono font-bold block">FAUCET FAILED</span>
                                                        <span className="text-[10px] opacity-80">{faucetMessage}</span>
                                                    </div>
                                                </div>
                                                <button onClick={() => setFaucetStatus('IDLE')} className="text-[10px] underline hover:text-red-400">Retry</button>
                                            </div>
                                        ) : (
                                            <button
                                                onClick={handleStartFaucet}
                                                className="w-full btn-retro border-yellow-500/30 text-yellow-600 bg-yellow-500/5 hover:bg-yellow-500/10 text-xs py-3"
                                            >
                                                START MINING (5-15 MINS)
                                            </button>
                                        )}
                                    </div>
                                )}

                                {cryptoResult && (
                                    <div className={`mt-4 p-3 border text-xs font-mono break-all rounded-sm ${cryptoResult.success ? 'bg-green-500/10 border-green-500/20 text-green-600' : 'bg-destructive/10 border-destructive/20 text-destructive'
                                        }`}>
                                        {cryptoResult.message}
                                    </div>
                                )}
                            </div>

                            {/* LINK WALLET SECTION */}
                            <div className="md:col-span-2 pt-4 border-t border-border">
                                {wallet?.linked_solana_address ? (
                                    <div className="p-4 border border-green-500/30 bg-green-500/5 rounded-sm flex items-center gap-4">
                                        <ShieldCheck className="text-green-500 w-8 h-8" />
                                        <div>
                                            <h3 className="text-xs font-bold font-mono uppercase text-green-500">Wallet Linked</h3>
                                            <p className="text-xs font-mono text-muted-foreground">{wallet.linked_solana_address.slice(0, 4)}...{wallet.linked_solana_address.slice(-4)}</p>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center gap-4 p-4 border border-border rounded-sm bg-secondary/5">
                                        <div className="text-center">
                                            <h3 className="text-sm font-bold font-mono uppercase text-muted-foreground">Link External Wallet</h3>
                                            <p className="text-[10px] text-muted-foreground mb-4">Connect Solana wallet to enable features.</p>
                                        </div>

                                        <SolanaWalletButton />

                                        {connected && publicKey && (
                                            <button
                                                onClick={handleLinkWallet}
                                                disabled={cryptoProcessing}
                                                className="btn-retro btn-retro-outline text-xs py-2 px-4 w-full"
                                            >
                                                {cryptoProcessing ? 'Linking...' : `Link ${publicKey.toBase58().slice(0, 6)}... to Account`}
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}







            {/* FIAT MODE */}
            {
                activeTab === 'FIAT' && (
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
                                                        <div className="flex flex-col items-start gap-1">
                                                            <span>{new Date(tx.created_at).toLocaleDateString()}</span>
                                                            {/* Explorer Link */}
                                                            {tx.id && (tx.type === 'deposit' || tx.type.includes('solana') || tx.type.includes('bittensor')) && (
                                                                <a
                                                                    href={tx.description.includes('TAO')
                                                                        ? `https://taostats.io/extrinsic/${tx.id}` // Approximation, ID might not be hash, check api response
                                                                        : `https://solscan.io/tx/${tx.id}?cluster=${process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet'}`
                                                                    }
                                                                    target="_blank"
                                                                    rel="noreferrer"
                                                                    className="text-[10px] text-blue-400 hover:underline flex items-center gap-1"
                                                                >
                                                                    View on Chain <ArrowUpRight size={8} />
                                                                </a>
                                                            )}
                                                        </div>
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
                )
            }
        </div>
    );
}


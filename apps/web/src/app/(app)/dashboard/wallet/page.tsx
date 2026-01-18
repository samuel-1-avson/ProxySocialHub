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
  Plus,
  ArrowRight,
  Coins,
  Shield,
  Activity,
  Signal,
  Layers
} from 'lucide-react';

export default function WalletPage() {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<WalletType | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'FIAT' | 'CRYPTO'>('FIAT');

  // Fiat State
  const [action, setAction] = useState<'deposit' | 'withdraw' | null>(null);
  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState('');
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  // Crypto State
  const { address, isConnected } = useAccount();
  const [cryptoAmount, setCryptoAmount] = useState('');
  const { writeContract, data: hash, isPending: isWritePending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash });

  // Read Contract Data
  const { data: buyerBalance } = useReadContract({
    address: PROXY_MARKETPLACE_ADDRESS,
    abi: PROXY_MARKETPLACE_ABI,
    functionName: 'buyerDeposits',
    args: address ? [address] : undefined,
    query: { enabled: !!address }
  });

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
      const res = await withdrawWallet(parseFloat(amount), phone);
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
    writeContract({
      address: PROXY_MARKETPLACE_ADDRESS,
      abi: PROXY_MARKETPLACE_ABI,
      functionName: 'deposit',
      value: parseEther(cryptoAmount),
    });
  }

  if (loading) {
    return (
      <div className="min-h-[400px] flex flex-col items-center justify-center space-y-4">
        <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
        <p className="text-muted-foreground font-medium animate-pulse">Syncing Financial Protocols...</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-20 relative px-4 lg:px-8">
      {/* Decorative Elements */}
      <div className="absolute -top-40 -right-40 w-96 h-96 bg-primary/10 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute top-1/2 -left-40 w-80 h-80 bg-blue-500/5 rounded-full blur-[100px] pointer-events-none"></div>

      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-8 pt-4">
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-primary font-black text-[10px] uppercase tracking-[0.4em] mb-1 animate-pulse">
            <Signal size={14} />
            Finance Core Online
          </div>
          <h1 className="text-3xl md:text-5xl font-black text-white tracking-tighter uppercase italic">Financial <span className="text-primary not-italic">Hub</span></h1>
          <p className="text-muted-foreground max-w-lg text-sm font-medium leading-relaxed opacity-70">Secure gateway for protocol credit management and automated network settlements.</p>
        </div>

        <div className="flex items-center gap-3">
          {/* Mode Switcher */}
          <div className="flex p-1 rounded-xl bg-white/5 border border-white/10">
            <button
              onClick={() => setActiveTab('FIAT')}
              className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'FIAT' ? 'bg-primary text-black shadow-lg' : 'text-muted-foreground hover:text-white'}`}
            >
              Fiat (GHS)
            </button>
            <button
              onClick={() => setActiveTab('CRYPTO')}
              className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'CRYPTO' ? 'bg-blue-600 text-white shadow-lg' : 'text-muted-foreground hover:text-white'}`}
            >
              Crypto (ETH)
            </button>
          </div>
        </div>
      </div>

      {/* CRYPTO MODE */}
      {activeTab === 'CRYPTO' && (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="p-8 md:p-12 rounded-[2.5rem] bg-[var(--glass-bg)] border border-[var(--glass-border)] transition-all relative overflow-hidden">
            <div className="absolute top-0 right-0 p-10 opacity-[0.03]">
              <Layers className="w-64 h-64 text-blue-500" />
            </div>

            <div className="relative z-10 flex flex-col items-center justify-center space-y-8 text-center bg-black/20 p-8 rounded-3xl border border-white/5 backdrop-blur-sm max-w-2xl mx-auto">
              <ConnectButton showBalance={false} />

              {!isConnected ? (
                <div className="space-y-2">
                  <p className="text-white font-bold text-lg">Connect Wallet to Access Blockchain Layer</p>
                  <p className="text-muted-foreground text-sm">Validates ownership via Polygon Network</p>
                </div>
              ) : (
                <div className="w-full space-y-8 pt-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
                    <div className="p-6 rounded-2xl bg-white/5 border border-white/10 text-left">
                      <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-2">My Address</p>
                      <p className="text-xs font-mono text-white break-all">{address}</p>
                    </div>
                    <div className="p-6 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-left">
                      <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-2">On-Chain Balance</p>
                      <p className="text-3xl font-black text-white italic tracking-tighter">
                        {buyerBalance ? parseFloat(formatEther(buyerBalance)).toFixed(4) : '0.0000'} <span className="text-sm not-italic opacity-50">ETH</span>
                      </p>
                    </div>
                  </div>

                  {/* Crypto Deposit Form */}
                  <form onSubmit={handleCryptoDeposit} className="flex gap-4 max-w-md mx-auto">
                    <input
                      type="number"
                      step="0.0001"
                      placeholder="Amount (ETH)"
                      value={cryptoAmount}
                      onChange={(e) => setCryptoAmount(e.target.value)}
                      className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-blue-500/50"
                    />
                    <button
                      disabled={isWritePending || isConfirming}
                      className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl disabled:opacity-50 transition-all"
                    >
                      {isWritePending || isConfirming ? 'Processing...' : 'Deposit'}
                    </button>
                  </form>
                  {hash && <p className="text-xs text-green-400">Transaction Hash: {hash}</p>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* FIAT MODE (Existing UI) */}
      {activeTab === 'FIAT' && (
        <>
          {/* Main Balance Card */}
          <div className="relative group p-8 md:p-12 rounded-[2.5rem] bg-[var(--glass-bg)] border border-[var(--glass-border)] overflow-hidden shadow-[var(--glass-shadow)] transition-all duration-700 hover:border-primary/20 animate-in fade-in slide-in-from-left-4 duration-500">
            <div className="absolute top-0 right-0 p-10 transition-all duration-700 group-hover:scale-110 opacity-[0.02]">
              <Coins className="w-64 h-64 text-primary" />
            </div>

            <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-10">
              <div className="space-y-4 text-center lg:text-left">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
                  <WalletIcon size={14} className="text-primary" />
                  <span className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Protocol Balance</span>
                </div>

                <div className="space-y-1">
                  <div className="text-6xl md:text-7xl font-black text-white tracking-tighter flex items-baseline justify-center lg:justify-start gap-2 italic">
                    <span className="text-2xl md:text-3xl opacity-20 not-italic font-bold select-none">{wallet?.currency || '₵'}</span>
                    {wallet?.balance?.toFixed(2) || '0.00'}
                  </div>
                  <div className="flex items-center justify-center lg:justify-start gap-3">
                    <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-50">
                      <Activity size={10} className="text-green-500" />
                      Synchronized
                    </div>
                    <div className="w-1 h-1 rounded-full bg-white/10"></div>
                    <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-50">
                      {wallet?.currency || 'GHS'} Network
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
                <button
                  onClick={() => { setAction('deposit'); setResult(null); }}
                  className="flex-1 lg:flex-none group relative px-8 py-4 rounded-2xl bg-primary text-black font-black uppercase tracking-widest text-[10px] overflow-hidden transition-all hover:scale-[1.02] active:scale-95 shadow-[0_15px_30px_-8px_rgba(34,197,94,0.3)]"
                >
                  <div className="relative z-10 flex items-center justify-center gap-2">
                    <ArrowDownLeft size={18} className="transition-transform group-hover:-translate-x-1 group-hover:translate-y-1" />
                    <span>Initialize Deposit</span>
                  </div>
                </button>
                <button
                  onClick={() => { setAction('withdraw'); setResult(null); }}
                  className="flex-1 lg:flex-none group relative px-8 py-4 rounded-2xl bg-white/[0.05] border border-white/10 text-white font-black uppercase tracking-widest text-[10px] transition-all hover:bg-white/[0.08] hover:border-white/20 active:scale-95"
                >
                  <div className="relative z-10 flex items-center justify-center gap-2">
                    <ArrowUpRight size={18} className="transition-transform group-hover:translate-x-1 group-hover:-translate-y-1" />
                    <span>Withdraw Credits</span>
                  </div>
                </button>
              </div>
            </div>
          </div>

          {/* Grid: Stats & History */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
            {/* Transaction History - Column Span 2 */}
            <div className="lg:col-span-2 space-y-5">
              <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-2.5 text-white font-black uppercase tracking-[0.2em] text-[10px]">
                  <History size={16} className="text-primary" />
                  Ledger Synchronicity
                </div>
                <div className="h-[1px] flex-1 mx-4 bg-gradient-to-r from-white/10 to-transparent"></div>
                <span className="text-[8px] font-black text-muted-foreground opacity-30 uppercase tracking-widest">REAL-TIME LOG</span>
              </div>

              <div className="rounded-[2rem] bg-[var(--glass-bg)] border border-[var(--glass-border)] overflow-hidden shadow-[var(--glass-shadow)] transition-all hover:border-[var(--glass-border)]/20">
                {(!wallet?.transactions || wallet.transactions.length === 0) ? (
                  <div className="p-16 text-center space-y-5">
                    <div className="w-16 h-16 rounded-full bg-white/[0.02] border border-white/5 flex items-center justify-center mx-auto text-white/5 animate-pulse">
                      <History size={32} />
                    </div>
                    <div className="space-y-1">
                      <p className="text-white font-black uppercase tracking-widest text-xs italic">Ledger Empty</p>
                      <p className="text-muted-foreground text-[8px] font-bold uppercase tracking-widest opacity-30">Await first protocol settlement</p>
                    </div>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="bg-white/[0.01]">
                          <th className="px-6 py-4 text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-40">Operation</th>
                          <th className="px-6 py-4 text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-40">Quantum</th>
                          <th className="px-6 py-4 text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-40">Status</th>
                          <th className="px-6 py-4 text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-40">Timestamp</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {wallet.transactions.map((tx) => (
                          <tr key={tx.id} className="group hover:bg-white/[0.01] transition-all duration-300">
                            <td className="px-6 py-5">
                              <div className="flex flex-col gap-0.5">
                                <span className="text-xs font-black text-white uppercase tracking-tight italic group-hover:text-primary transition-colors">{tx.description}</span>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[8px] font-black uppercase tracking-widest text-muted-foreground opacity-30">{tx.type}</span>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-5">
                              <div className={`text-xs font-black italic tracking-tighter tabular-nums ${tx.amount >= 0 ? 'text-primary' : 'text-red-400'}`}>
                                {tx.amount >= 0 ? '+' : ''}{tx.amount.toFixed(2)}
                              </div>
                            </td>
                            <td className="px-6 py-5">
                              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/5 border border-white/5 text-[8px] font-black uppercase tracking-[0.2em] text-muted-foreground">
                                <div className="w-1 h-1 rounded-full bg-primary animate-pulse"></div>
                                Settled
                              </div>
                            </td>
                            <td className="px-6 py-5">
                              <div className="flex items-center gap-1.5 text-[9px] font-bold text-muted-foreground opacity-30">
                                <Clock size={10} />
                                {new Date(tx.created_at).toLocaleDateString()}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Network Rates - Column Span 1 */}
            <div className="space-y-5">
              <div className="flex items-center gap-2.5 text-white font-black uppercase tracking-[0.2em] text-[10px] px-2">
                <Zap size={16} className="text-primary" />
                Exchange Rates
              </div>

              <div className="space-y-3">
                {[
                  { label: 'Bandwidth Leak', price: '₵0.50', sub: 'per GB protocol data', icon: Zap, color: 'text-orange-400' },
                  { label: 'Entry Threshold', price: '₵1.00', sub: 'Min Network Deposit', icon: ArrowDownLeft, color: 'text-primary' },
                  { label: 'Exit Threshold', price: '₵5.00', sub: 'Min External Transfer', icon: ArrowUpRight, color: 'text-blue-400' },
                ].map((p, i) => (
                  <div key={i} className="group relative p-6 rounded-[2rem] bg-[var(--glass-bg)] border border-[var(--glass-border)] transition-all duration-500 hover:border-primary/20 shadow-[var(--glass-shadow)] overflow-hidden">
                    <div className="absolute top-0 right-0 p-5 opacity-[0.03] group-hover:scale-110 transition-transform">
                      <p.icon size={42} className={p.color} />
                    </div>
                    <div className="relative z-10 flex items-center justify-between">
                      <div className="space-y-1">
                        <div className="text-[8px] font-black text-muted-foreground uppercase tracking-widest opacity-40 group-hover:opacity-60 transition-opacity">
                          {p.label}
                        </div>
                        <div className="text-3xl font-black text-white tracking-tighter italic">{p.price}</div>
                        <div className="text-[7px] font-black text-muted-foreground uppercase tracking-widest opacity-30">
                          {p.sub}
                        </div>
                      </div>
                      <div className={`p-2.5 rounded-xl bg-white/5 ${p.color}`}>
                        <p.icon size={18} />
                      </div>
                    </div>
                  </div>
                ))}

                <div className="p-6 rounded-[2rem] bg-primary/5 border border-primary/10 flex items-start gap-4 group">
                  <div className="p-1.5 rounded-lg bg-primary/10 text-primary group-hover:scale-110 transition-transform">
                    <Shield size={16} />
                  </div>
                  <p className="text-[9px] font-bold text-white/40 leading-relaxed uppercase tracking-wider">
                    Algorithms adjust rates based on <span className="text-primary italic">Global Demand</span>. All settlements are immutable.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Modal Overlay */}
          {action && (
            <div className="fixed inset-0 bg-[#000]/95 backdrop-blur-xl flex items-center justify-center z-[100] p-6 animate-in fade-in duration-500">
              <div className="bg-[#050505] border border-white/10 rounded-[3rem] p-8 md:p-12 max-w-lg w-full relative overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-8 duration-500 shadow-2xl">
                {/* Modal Ambient Light */}
                <div className={`absolute top-[-20%] left-1/2 -translate-x-1/2 w-[80%] h-[40%] blur-[120px] opacity-20 ${action === 'deposit' ? 'bg-primary' : 'bg-blue-500'}`}></div>

                <button
                  onClick={() => setAction(null)}
                  className="absolute top-8 right-8 p-2.5 rounded-xl bg-white/5 border border-white/10 text-muted-foreground hover:text-white transition-all hover:rotate-90 z-[110]"
                >
                  <X size={20} />
                </button>

                <div className="relative z-10 space-y-8">
                  <div className="flex items-center gap-5">
                    <div className={`p-4 rounded-2xl ${action === 'deposit' ? 'bg-primary/20 text-primary shadow-[0_0_30px_rgba(34,197,94,0.15)]' : 'bg-blue-500/20 text-blue-500 shadow-[0_0_30px_rgba(59,130,246,0.15)]'}`}>
                      {action === 'deposit' ? <CreditCard size={28} /> : <Smartphone size={28} />}
                    </div>
                    <div className="space-y-0.5">
                      <h3 className="text-2xl font-black text-white tracking-tighter uppercase italic">
                        {action === 'deposit' ? 'Protocol Deposit' : 'Network Payout'}
                      </h3>
                      <div className="flex items-center gap-1.5">
                        <Signal size={10} className="text-primary opacity-50" />
                        <p className="text-[8px] font-black text-muted-foreground uppercase tracking-[0.3em] opacity-40">
                          {action === 'deposit' ? 'Securing outbound tunnel' : 'Routing to terminal ID'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {result && (
                    <div className={`p-4 rounded-2xl flex items-center gap-4 animate-in slide-in-from-top-4 duration-500 ${result.success ? 'bg-primary/10 border border-primary/20 text-primary' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>
                      <div className="p-1.5 rounded-full bg-white/5">
                        {result.success ? <ShieldCheck size={18} /> : <Info size={18} />}
                      </div>
                      <p className="text-[10px] font-black uppercase tracking-widest leading-relaxed">{result.message}</p>
                    </div>
                  )}

                  <form onSubmit={action === 'deposit' ? handleDeposit : handleWithdraw} className="space-y-8">
                    <div className="space-y-3">
                      <label className="block text-[9px] font-black uppercase tracking-[0.4em] text-white/20 ml-1">Protocol Quantity (₵)</label>
                      <div className="relative group/input">
                        <div className="absolute left-6 top-1/2 -translate-y-1/2 text-white/5 font-black text-xl group-focus-within/input:text-primary transition-all duration-500">₵</div>
                        <input
                          type="number"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          placeholder={action === 'deposit' ? '1.00 +' : '5.00 +'}
                          min={action === 'deposit' ? 1 : 5}
                          step="0.01"
                          required
                          className="w-full bg-white/[0.01] border border-white/5 rounded-2xl py-6 pl-12 pr-6 text-2xl font-black text-white outline-none focus:border-primary/50 focus:bg-white/[0.03] transition-all duration-500 placeholder:text-white/5"
                        />
                      </div>
                    </div>

                    {action === 'withdraw' && (
                      <div className="space-y-3 animate-in fade-in slide-in-from-top-4 duration-500">
                        <label className="block text-[9px] font-black uppercase tracking-[0.4em] text-white/20 ml-1">MoMo Terminal Address</label>
                        <div className="relative group/input">
                          <Smartphone className="absolute left-6 top-1/2 -translate-y-1/2 text-white/5 group-focus-within/input:text-blue-500 transition-all duration-500" size={20} />
                          <input
                            type="tel"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            placeholder="ID (05XXXXXXX)"
                            required
                            className="w-full bg-white/[0.01] border border-white/5 rounded-2xl py-6 pl-14 pr-6 text-xl font-black text-white outline-none focus:border-blue-500/50 focus:bg-white/[0.03] transition-all duration-500 placeholder:text-white/5"
                          />
                        </div>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={processing}
                      className={`w-full group relative py-6 rounded-2xl font-black uppercase tracking-[0.3em] text-[10px] transition-all duration-500 flex items-center justify-center gap-3 disabled:opacity-50 ${action === 'deposit'
                        ? 'bg-primary text-black hover:shadow-[0_0_50px_rgba(34,197,94,0.3)] hover:scale-[1.01]'
                        : 'bg-blue-600 text-white hover:bg-blue-500 hover:shadow-[0_0_50px_rgba(59,130,246,0.3)] hover:scale-[1.01]'
                        }`}
                    >
                      {processing ? (
                        <div className="flex items-center gap-3">
                          <div className="w-5 h-5 border-4 border-current border-t-transparent rounded-full animate-spin"></div>
                          <span>Synching Protocol...</span>
                        </div>
                      ) : (
                        <>
                          <span>{action === 'deposit' ? 'Authorize Payment' : 'Confirm Payout'}</span>
                          <ArrowRight size={18} className="transition-transform group-hover:translate-x-1.5" />
                        </>
                      )}
                    </button>
                  </form>

                  <p className="text-center text-[8px] font-black uppercase tracking-[0.2em] text-white/10">
                    End-to-end encrypted. Settlement is immutable.
                  </p>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
